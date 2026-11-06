import AVFoundation
import Combine
import Photos
import UIKit

@MainActor
final class NativeMomentModel: ObservableObject {
    @Published private(set) var source: URL?
    @Published private(set) var output: URL?
    @Published private(set) var thumbnails: [UIImage?] = []
    @Published private(set) var isGeneratingThumbnails = false
    @Published private(set) var duration = 0.0
    @Published var start = 0.0
    @Published var footage = 1.0
    @Published var shoutout: NativeMomentShoutout?
    @Published var introSeconds = NativeMomentPlan.introSeconds
    @Published var introMusicEnabled = true
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
    @Published private(set) var previewID = UUID()
    private var thumbnailTask: Task<[UIImage?], Never>?
    private var thumbnailRequestID = UUID()

    var maximumFootage: Double { min(NativeMomentPlan.maximumFootage, duration) }
    var minimumFootage: Double { min(0.1, duration) }
    var minimumStart: Double { max(0, start + footage - maximumFootage) }
    var maximumStart: Double { max(minimumStart, start + footage - minimumFootage) }
    var plan: NativeMomentPlan? {
        guard let shoutout else { return nil }
        let intro = shoutout.fixedIntroSeconds ?? introSeconds
        return try? NativeMomentPlan(sourceDuration: duration, start: start, footage: footage, intro: intro)
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
                    shoutout = nil
                    introMusicEnabled = true
                    self.source = url
                    self.duration = duration
                    self.start = 0
                    self.footage = min(15, duration)
                    self.hasAudio = hasAudio
                    generateThumbnails(for: url, duration: duration)
                    updatePreview()
                    message = hasAudio
                        ? "Source audio will be preserved."
                        : "This source has no audio."
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
        footage = min(footage, max(minimumFootage, duration - start), NativeMomentPlan.maximumFootage)
        clearOutput()
        updatePreview()
        message = nil
    }

    func introMusicSelectionChanged() {
        guard !busy else { return }
        clearOutput()
        updatePreview()
        message = nil
    }

    /// Moves the in-point while keeping the selected out-point fixed.
    func setTrimStart(_ proposedStart: Double) {
        guard duration > 0 else { return }
        let end = start + footage
        let lowerBound = max(0, end - maximumFootage)
        let upperBound = max(lowerBound, end - minimumFootage)
        let newStart = min(max(proposedStart, lowerBound), upperBound)
        footage = end - newStart
        start = newStart
    }

    /// Moves the out-point while keeping the selected in-point fixed.
    func setTrimEnd(_ proposedEnd: Double) {
        guard duration > 0 else { return }
        let minimumEnd = start + minimumFootage
        let maximumEnd = min(duration, start + maximumFootage)
        let newEnd = min(max(proposedEnd, minimumEnd), maximumEnd)
        footage = newEnd - start
    }

    func export() {
        guard let source, let plan, let shoutout, !busy else { return }
        guard let artwork = UIImage(named: shoutout.asset)?.cgImage else {
            error = "The selected shoutout is missing. Choose another graphic."
            return
        }
        let shoutoutVideo: URL?
        if let resource = shoutout.videoResource {
            guard let bundledVideo = Bundle.main.url(forResource: resource, withExtension: "mp4") else {
                error = "The animated shoutout isn’t available. Choose another intro."
                return
            }
            shoutoutVideo = bundledVideo
        } else {
            shoutoutVideo = nil
        }
        let introMusicURL: URL?
        if introMusicEnabled, shoutout.videoResource != nil {
            guard let bundledMusic = Bundle.main.url(forResource: "RecordMomentClutchIntroMusic", withExtension: "m4a") else {
                error = "The animated intro music isn’t available. Turn it off and try again."
                return
            }
            introMusicURL = bundledMusic
        } else {
            introMusicURL = nil
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
                let url = try await exporter.export(
                    source: source,
                    shoutout: artwork,
                    plan: plan,
                    directory: directory,
                    shoutoutVideo: shoutoutVideo,
                    introMusicURL: introMusicURL
                )
                unclaimedOutput = url
                try Task.checkCancellation()
                clearOutput()
                output = url
                unclaimedOutput = nil
                setPreview(url: url, start: 0, end: plan.total)
                let musicNote = introMusicURL == nil ? "" : " Intro music plays only during the animated intro."
                message = String(format: "Ready: %.1f-second animated intro + %.2f seconds of footage. Nothing has been uploaded.", plan.intro, plan.footage) + musicNote
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
        thumbnailTask?.cancel()
        thumbnailTask = nil
        thumbnailRequestID = UUID()
        isGeneratingThumbnails = false
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

    private func generateThumbnails(for url: URL, duration: Double) {
        thumbnailTask?.cancel()
        let requestID = UUID()
        thumbnailRequestID = requestID
        let count = 12
        thumbnails = Array(repeating: nil, count: count)
        isGeneratingThumbnails = true

        let task = Task.detached(priority: .utility) {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 180, height: 180)

            return await withTaskCancellationHandler {
                var images = Array<UIImage?>(repeating: nil, count: count)
                for index in 0..<count {
                    guard !Task.isCancelled else {
                        break
                    }
                    let seconds = duration * (Double(index) + 0.5) / Double(count)
                    let time = CMTime(seconds: seconds, preferredTimescale: 600)
                    let image: UIImage? = await withCheckedContinuation {
                        (continuation: CheckedContinuation<UIImage?, Never>) in
                        generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) {
                            _, cgImage, _, result, _ in
                            let image = result == .succeeded
                                ? cgImage.map { UIImage(cgImage: $0) }
                                : nil
                            continuation.resume(returning: image)
                        }
                    }
                    // Keep missing frames in their original timeline slots.
                    images[index] = image
                }
                return images
            } onCancel: {
                generator.cancelAllCGImageGeneration()
            }
        }
        thumbnailTask = task

        Task { [weak self] in
            let images = await task.value
            guard let self, self.thumbnailRequestID == requestID else { return }
            self.thumbnailTask = nil
            self.thumbnails = images
            self.isGeneratingThumbnails = false
        }
    }

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
