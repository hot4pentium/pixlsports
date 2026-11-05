import AVFoundation
import Combine
import Photos
import UIKit

@MainActor
final class NativeMomentModel: ObservableObject {
    @Published private(set) var source: URL?
    @Published private(set) var output: URL?
    @Published private(set) var duration = 0.0
    @Published var start = 0.0
    @Published var footage = 1.0
    @Published var shoutout: NativeMomentShoutout = .clutch
    @Published var introSeconds = NativeMomentPlan.introSeconds
    @Published private(set) var hasAudio = false
    @Published private(set) var busy = false
    @Published private(set) var isExporting = false
    @Published private(set) var isImporting = false
    @Published var message: String?
    @Published var error: String?
    @Published var permissionDenied = false
    @Published private(set) var player: AVPlayer?
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("PIXL-Moment-\(UUID())", isDirectory: true)
    private let exporter = NativeMomentExporter()
    private var operation: Task<Void, Never>?
    private var previewObserver: Any?
    private var closed = false
    private(set) var pickerID = UUID()
    private var importProgress: Progress?
    private var previewEnd = 0.0
    private var previewStart = 0.0
    private var previewID = UUID()

    var maximumFootage: Double { min(NativeMomentPlan.maximumFootage, duration) }
    var maximumStart: Double { max(0, duration - footage) }
    var plan: NativeMomentPlan? {
        try? NativeMomentPlan(sourceDuration: duration, start: start, footage: footage, intro: introSeconds)
    }

    func preparePicker() -> Bool {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            pickerID = UUID()
            message = nil
            return true
        } catch { self.error = "There isn’t enough space to prepare a local video. Free some space and try again."; return false }
    }

    func importing(id: UUID) {
        guard id == pickerID, !closed else { return }
        busy = true
        isImporting = true
        message = "Preparing your video on this iPhone…"
    }

    func trackImport(_ progress: Progress, id: UUID) {
        guard id == pickerID, !closed else { progress.cancel(); return }
        importProgress = progress
    }

    func cancelImport() {
        operation?.cancel()
        importProgress?.cancel()
        importProgress = nil
        pickerID = UUID() // Discard a provider's late result without replacing a newer selection.
        isImporting = false
        if operation == nil { busy = false }
        message = "Video import cancelled. Your current clip is unchanged."
    }

    /// Picker already copied its temporary provider/camera URL while it was valid.
    func receive(_ result: Result<URL?, Error>, id: UUID) {
        guard !closed, id == pickerID else {
            if case .success(.some(let url)) = result { try? FileManager.default.removeItem(at: url) }
            if closed { cleanup() }
            return
        }
        isImporting = false
        importProgress = nil
        switch result {
        case .success(nil):
            busy = false
            message = "Video selection cancelled. Your current clip is unchanged."
        case .failure(let error):
            busy = false
            message = nil
            self.error = "Couldn’t open that video. \(error.localizedDescription)"
        case .success(.some(let url)):
            busy = true
            isImporting = true
            operation = Task {
                defer { finishOperation() }
                do {
                    let asset = AVURLAsset(url: url)
                    let duration = try await asset.load(.duration).seconds
                    guard duration.isFinite, duration > 0,
                          !(try await asset.loadTracks(withMediaType: .video)).isEmpty else {
                        throw NativeMomentError.message("Choose a readable, non-empty video.")
                    }
                    let hasAudio = !(try await asset.loadTracks(withMediaType: .audio)).isEmpty
                    try Task.checkCancellation()
                    clearOutput()
                    if let source { try? FileManager.default.removeItem(at: source) }
                    self.source = url
                    self.duration = duration
                    self.start = 0
                    self.footage = min(15, duration)
                    self.hasAudio = hasAudio
                    updatePreview()
                    message = hasAudio ? "Source audio will be preserved." : "This source has no audio. The finished clip will be silent."
                } catch {
                    try? FileManager.default.removeItem(at: url)
                    handle(error)
                }
            }
        }
    }

    func selectionChanged() {
        guard !busy else { return }
        start = min(start, maximumStart)
        clearOutput()
        updatePreview()
        message = nil
    }

    func export() {
        guard let source, let plan, !busy else { return }
        guard let artwork = UIImage(named: shoutout.asset)?.cgImage else {
            error = "The selected shoutout is missing. Choose another graphic."
            return
        }
        busy = true
        isExporting = true
        message = "Creating your MP4 on this iPhone…"
        player?.pause()
        operation = Task {
            defer { finishOperation() }
            var unclaimedOutput: URL?
            defer { if let unclaimedOutput { try? FileManager.default.removeItem(at: unclaimedOutput) } }
            do {
                let url = try await exporter.export(source: source, shoutout: artwork, plan: plan, directory: directory)
                unclaimedOutput = url
                try Task.checkCancellation()
                clearOutput()
                output = url
                unclaimedOutput = nil
                setPreview(url: url, start: 0, end: plan.total)
                message = String(format: "Ready: %.1f-second intro + %.2f seconds of footage. Nothing has been uploaded.", plan.intro, plan.footage)
            } catch { handle(error) }
        }
    }

    func save() {
        guard let output, !busy else { return }
        busy = true
        player?.pause()
        operation = Task {
            defer { finishOperation() }
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard status == .authorized || status == .limited else {
                permissionDenied = true
                error = "Allow Photos access in Settings to save your finished clip. You can still use Share."
                return
            }
            // Do not cancel/delete the file while Photos is reading it.
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: output)
                }
                message = "Saved to Photos. You can share it later from your library."
            } catch { self.error = "Couldn’t save to Photos. \(error.localizedDescription) Your preview is still available to retry or share." }
        }
    }

    func stopPlayback() { player?.pause() }

    func cancelExport() {
        operation?.cancel()
        exporter.cancel()
    }

    func shutdown() {
        closed = true
        if isImporting { cancelImport() }
        stopPlayback()
        releasePlayer()
        cancelExport()
        if !busy { cleanup() }
    }

    private func handle(_ error: Error) {
        if Task.isCancelled || error is CancellationError {
            message = "Cancelled. Your source video is unchanged."
        } else {
            message = nil
            self.error = error.localizedDescription
        }
    }

    private func finishOperation() {
        busy = false
        isExporting = false
        isImporting = false
        operation = nil
        if closed { cleanup() }
    }

    private func cleanup() { try? FileManager.default.removeItem(at: directory) }

    private func clearOutput() {
        releasePlayer()
        if let output { try? FileManager.default.removeItem(at: output) }
        output = nil
    }

    private func updatePreview() {
        guard let source else { return }
        setPreview(url: source, start: start, end: start + footage)
    }

    private func releasePlayer() {
        previewID = UUID()
        player?.pause()
        if let previewObserver { player?.removeTimeObserver(previewObserver) }
        previewObserver = nil
        player?.replaceCurrentItem(with: nil)
        player = nil
    }

    private func setPreview(url: URL, start: Double, end: Double) {
        releasePlayer()
        previewStart = start
        previewEnd = end
        let player = AVPlayer(url: url)
        player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        self.player = player
        let id = previewID
        previewObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 20), queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in
                guard let self, self.previewID == id, let current = self.player else { return }
                if time.seconds >= self.previewEnd || time.seconds < self.previewStart - 0.1 {
                    current.pause()
                    current.seek(to: CMTime(seconds: self.previewStart, preferredTimescale: 600),
                                 toleranceBefore: .zero, toleranceAfter: .zero)
                }
            }
        }
    }
}
