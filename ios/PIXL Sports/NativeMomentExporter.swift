import AVFoundation
import CoreGraphics

/// All files belong to the caller's disposable workspace. No network or library writes.
@MainActor
final class NativeMomentExporter {
    private var writer: AVAssetWriter?
    private var session: AVAssetExportSession?

    func cancel() {
        writer?.cancelWriting()
        session?.cancelExport()
    }

    func export(source: URL, shoutout: CGImage, plan: NativeMomentPlan, directory: URL) async throws -> URL {
        defer {
            if writer?.status == .writing { writer?.cancelWriting() }
            writer = nil
            session = nil
        }
        let asset = AVURLAsset(url: source)
        guard let video = try await asset.loadTracks(withMediaType: .video).first else {
            throw NativeMomentError.message("This file has no readable video.")
        }
        let naturalSize = try await video.load(.naturalSize)
        let preferredTransform = try await video.load(.preferredTransform)
        let oriented = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform).standardized
        guard oriented.width > 0, oriented.height > 0 else {
            throw NativeMomentError.message("This video’s dimensions could not be read.")
        }
        let scale = min(1, 1080 / max(oriented.width, oriented.height))
        let size = CGSize(width: max(2, floor(oriented.width * scale / 2) * 2),
                          height: max(2, floor(oriented.height * scale / 2) * 2))
        let introURL = directory.appendingPathComponent("intro-\(UUID()).mp4")
        defer { try? FileManager.default.removeItem(at: introURL) }
        try await writeIntro(image: shoutout, size: size, seconds: plan.intro, to: introURL)
        try Task.checkCancellation()
        let introAsset = AVURLAsset(url: introURL)
        guard let introVideo = try await introAsset.loadTracks(withMediaType: .video).first else {
            throw NativeMomentError.message("The shoutout intro could not be read.")
        }
        let composition = AVMutableComposition()
        guard let introTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let footageTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw NativeMomentError.message("The clip could not be prepared.")
        }
        let introTime = CMTime(seconds: plan.intro, preferredTimescale: 600)
        let range = CMTimeRange(start: CMTime(seconds: plan.start, preferredTimescale: 600),
                                duration: CMTime(seconds: plan.footage, preferredTimescale: 600))
        try introTrack.insertTimeRange(CMTimeRange(start: .zero, duration: introTime), of: introVideo, at: .zero)
        try footageTrack.insertTimeRange(range, of: video, at: introTime)
        // Intersect audio's real range; some phone movies start audio later than video.
        for sourceAudio in try await asset.loadTracks(withMediaType: .audio) {
            let available = try await sourceAudio.load(.timeRange)
            let overlap = CMTimeRangeGetIntersection(range, otherRange: available)
            if overlap.isValid, !overlap.isEmpty {
                guard let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                    throw NativeMomentError.message("The source audio could not be preserved.")
                }
                try audio.insertTimeRange(overlap, of: sourceAudio,
                    at: CMTimeAdd(introTime, CMTimeSubtract(overlap.start, range.start)))
            }
        }
        let introInstruction = AVMutableVideoCompositionInstruction()
        introInstruction.timeRange = CMTimeRange(start: .zero, duration: introTime)
        introInstruction.layerInstructions = [AVMutableVideoCompositionLayerInstruction(assetTrack: introTrack)]
        let footageInstruction = AVMutableVideoCompositionInstruction()
        footageInstruction.timeRange = CMTimeRange(start: introTime, duration: range.duration)
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: footageTrack)
        // Normalize all rotations/mirroring, then aspect-fit without cropping any action.
        let fit = min(size.width / oriented.width, size.height / oriented.height)
        let transform = preferredTransform
            .concatenating(CGAffineTransform(translationX: -oriented.minX, y: -oriented.minY))
            .concatenating(CGAffineTransform(scaleX: fit, y: fit))
            .concatenating(CGAffineTransform(
                translationX: (size.width - oriented.width * fit) / 2,
                y: (size.height - oriented.height * fit) / 2))
        layer.setTransform(transform, at: introTime)
        footageInstruction.layerInstructions = [layer]
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = size
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.instructions = [introInstruction, footageInstruction]
        let output = directory.appendingPathComponent("PIXL-Moment-\(UUID()).mp4")
        var success = false
        defer { if !success { try? FileManager.default.removeItem(at: output) } }
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw NativeMomentError.message("MP4 export is not available for this video.")
        }
        session = export
        export.outputURL = output
        export.outputFileType = .mp4
        export.videoComposition = videoComposition
        export.timeRange = CMTimeRange(start: .zero, duration: CMTimeAdd(introTime, range.duration))
        export.shouldOptimizeForNetworkUse = false
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            export.exportAsynchronously { continuation.resume() }
        }
        try Task.checkCancellation()
        guard export.status == .completed else {
            if export.status == .cancelled { throw CancellationError() }
            throw export.error ?? NativeMomentError.message("The video could not be exported. Try another clip.")
        }
        // Inspect the actual MP4, never just the requested composition/manifest duration.
        let finished = AVURLAsset(url: output)
        let duration = try await finished.load(.duration).seconds
        guard duration.isFinite, abs(duration - plan.total) <= 0.12,
              !(try await finished.loadTracks(withMediaType: .video)).isEmpty else {
            throw NativeMomentError.message("The finished clip was incomplete. Please try again.")
        }
        let expectedAudio = try await composition.loadTracks(withMediaType: .audio)
        if !expectedAudio.isEmpty, (try await finished.loadTracks(withMediaType: .audio)).isEmpty {
            throw NativeMomentError.message("The source audio was missing from the finished clip. Please try again.")
        }
        success = true
        return output
    }

    private func writeIntro(image: CGImage, size: CGSize, seconds: Double, to url: URL) async throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        self.writer = writer
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height)
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                kCVPixelBufferWidthKey as String: Int(size.width),
                kCVPixelBufferHeightKey as String: Int(size.height),
                kCVPixelBufferCGImageCompatibilityKey as String: true,
                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
            ])
        guard writer.canAdd(input) else { throw NativeMomentError.message("The intro could not be encoded.") }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? NativeMomentError.message("The intro could not be started.") }
        writer.startSession(atSourceTime: .zero)
        guard let pool = adaptor.pixelBufferPool else { throw NativeMomentError.message("Not enough memory to prepare the intro.") }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
            throw NativeMomentError.message("Not enough memory to prepare the intro.")
        }
        CVPixelBufferLockBaseAddress(buffer, [])
        guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer),
            width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else {
            CVPixelBufferUnlockBaseAddress(buffer, [])
            throw NativeMomentError.message("The shoutout artwork could not be read.")
        }
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.fill(CGRect(origin: .zero, size: size))
        let side = min(size.width, size.height)
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: (size.width - side) / 2, y: (size.height - side) / 2, width: side, height: side))
        CVPixelBufferUnlockBaseAddress(buffer, [])
        for frame in 0..<Int(ceil(seconds * 30)) {
            while !input.isReadyForMoreMediaData {
                try Task.checkCancellation()
                guard writer.status == .writing else {
                    throw writer.error ?? NativeMomentError.message("The intro export stopped.")
                }
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            try Task.checkCancellation()
            guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 30)) else {
                throw writer.error ?? NativeMomentError.message("The intro could not be written.")
            }
        }
        writer.endSession(atSourceTime: CMTime(seconds: seconds, preferredTimescale: 600))
        input.markAsFinished()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting { continuation.resume() }
        }
        try Task.checkCancellation()
        guard writer.status == .completed else {
            throw writer.error ?? NativeMomentError.message("The intro export did not finish.")
        }
        self.writer = nil
    }
}
