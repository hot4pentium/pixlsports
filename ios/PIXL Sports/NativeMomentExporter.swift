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

    func export(
        source: URL,
        shoutout: CGImage,
        plan: NativeMomentPlan,
        directory: URL,
        shoutoutVideo: URL? = nil,
        shoutoutVideoPortrait: URL? = nil,
        introMusicURL: URL? = nil
    ) async throws -> URL {
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
        let introTime = CMTime(seconds: plan.intro, preferredTimescale: 600)
        var generatedIntroURL: URL?
        let introAsset: AVURLAsset
        if let shoutoutVideo {
            let introURL: URL
            if oriented.height > oriented.width {
                guard let shoutoutVideoPortrait else {
                    throw NativeMomentError.message("A portrait version of this animated shoutout isn’t available.")
                }
                introURL = shoutoutVideoPortrait
            } else {
                introURL = shoutoutVideo
            }
            introAsset = AVURLAsset(url: introURL)
        } else {
            let introURL = directory.appendingPathComponent("intro-\(UUID()).mp4")
            generatedIntroURL = introURL
            try await writeIntro(image: shoutout, size: size, seconds: plan.intro, to: introURL)
            introAsset = AVURLAsset(url: introURL)
        }
        defer {
            if let generatedIntroURL { try? FileManager.default.removeItem(at: generatedIntroURL) }
        }
        try Task.checkCancellation()
        guard let introVideo = try await introAsset.loadTracks(withMediaType: .video).first else {
            throw NativeMomentError.message("The shoutout intro could not be read.")
        }
        let introAvailable = try await introVideo.load(.timeRange)
        guard introAvailable.duration.seconds + 0.001 >= plan.intro else {
            throw NativeMomentError.message("The animated shoutout is shorter than its selected intro time.")
        }
        let introNaturalSize = try await introVideo.load(.naturalSize)
        let introPreferredTransform = try await introVideo.load(.preferredTransform)
        let introOriented = CGRect(origin: .zero, size: introNaturalSize)
            .applying(introPreferredTransform).standardized
        guard introOriented.width > 0, introOriented.height > 0 else {
            throw NativeMomentError.message("The shoutout intro’s dimensions could not be read.")
        }
        let composition = AVMutableComposition()
        guard let introTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let footageTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw NativeMomentError.message("The clip could not be prepared.")
        }
        let range = CMTimeRange(start: CMTime(seconds: plan.start, preferredTimescale: 600),
                                duration: CMTime(seconds: plan.footage, preferredTimescale: 600))
        let totalTime = CMTimeAdd(introTime, range.duration)
        try introTrack.insertTimeRange(
            CMTimeRange(start: introAvailable.start, duration: introTime),
            of: introVideo,
            at: .zero
        )
        try footageTrack.insertTimeRange(range, of: video, at: introTime)
        // Intersect audio's real range; some phone movies start audio later than video.
        var audioMixParameters: [AVMutableAudioMixInputParameters] = []
        for sourceAudio in try await asset.loadTracks(withMediaType: .audio) {
            let available = try await sourceAudio.load(.timeRange)
            let overlap = CMTimeRangeGetIntersection(range, otherRange: available)
            if overlap.isValid, !overlap.isEmpty {
                guard let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                    throw NativeMomentError.message("The source audio could not be preserved.")
                }
                let audioStart = CMTimeAdd(introTime, CMTimeSubtract(overlap.start, range.start))
                try audio.insertTimeRange(overlap, of: sourceAudio, at: audioStart)
                let parameters = AVMutableAudioMixInputParameters(track: audio)
                // Ease into the original sound without delaying or trimming the footage.
                let sourceFadeDuration = CMTime(
                    seconds: min(0.35, overlap.duration.seconds),
                    preferredTimescale: 600
                )
                parameters.setVolumeRamp(
                    fromStartVolume: 0,
                    toEndVolume: 1,
                    timeRange: CMTimeRange(start: audioStart, duration: sourceFadeDuration)
                )
                parameters.setVolume(1, at: CMTimeAdd(audioStart, sourceFadeDuration))
                audioMixParameters.append(parameters)
            }
        }
        if let introMusicURL {
            let musicAsset = AVURLAsset(url: introMusicURL)
            guard let musicSource = try await musicAsset.loadTracks(withMediaType: .audio).first else {
                throw NativeMomentError.message("The intro music could not be read.")
            }
            let musicAvailable = try await musicSource.load(.timeRange)
            let musicDuration = CMTime(seconds: max(0, plan.intro - 0.12), preferredTimescale: 600)
            guard musicDuration.seconds > 0,
                  musicAvailable.duration.seconds + 0.001 >= musicDuration.seconds else {
                throw NativeMomentError.message("The intro music is too short.")
            }
            guard let musicTrack = composition.addMutableTrack(
                withMediaType: .audio,
                preferredTrackID: kCMPersistentTrackID_Invalid
            ) else {
                throw NativeMomentError.message("The intro music could not be added.")
            }
            try musicTrack.insertTimeRange(
                CMTimeRange(start: musicAvailable.start, duration: musicDuration),
                of: musicSource,
                at: .zero
            )
            let parameters = AVMutableAudioMixInputParameters(track: musicTrack)
            let volume: Float = 0.55
            let fadeIn = CMTime(seconds: min(0.08, musicDuration.seconds / 4), preferredTimescale: 600)
            let fadeOut = CMTime(seconds: min(0.24, musicDuration.seconds / 4), preferredTimescale: 600)
            parameters.setVolumeRamp(
                fromStartVolume: 0,
                toEndVolume: volume,
                timeRange: CMTimeRange(start: .zero, duration: fadeIn)
            )
            parameters.setVolumeRamp(
                fromStartVolume: volume,
                toEndVolume: 0,
                timeRange: CMTimeRange(start: CMTimeSubtract(musicDuration, fadeOut), duration: fadeOut)
            )
            audioMixParameters.append(parameters)
        }
        let introInstruction = AVMutableVideoCompositionInstruction()
        introInstruction.timeRange = CMTimeRange(start: .zero, duration: introTime)
        introInstruction.backgroundColor = CGColor(gray: 0, alpha: 1)
        let introLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: introTrack)
        // Preserve the intro's full frame in portrait and landscape exports.
        let introFit = min(size.width / introOriented.width, size.height / introOriented.height)
        let introTransform = introPreferredTransform
            .concatenating(CGAffineTransform(
                translationX: -introOriented.minX,
                y: -introOriented.minY
            ))
            .concatenating(CGAffineTransform(scaleX: introFit, y: introFit))
            .concatenating(CGAffineTransform(
                translationX: (size.width - introOriented.width * introFit) / 2,
                y: (size.height - introOriented.height * introFit) / 2
            ))
        introLayer.setTransform(introTransform, at: .zero)
        introInstruction.layerInstructions = [introLayer]
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
        export.timeRange = CMTimeRange(start: .zero, duration: totalTime)
        if !audioMixParameters.isEmpty {
            let audioMix = AVMutableAudioMix()
            audioMix.inputParameters = audioMixParameters
            export.audioMix = audioMix
        }
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
            throw NativeMomentError.message("Audio was missing from the finished clip. Please try again.")
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
        let side = min(size.width, size.height)
        let frameCount = max(1, Int(ceil(seconds * 30)))
        for frame in 0..<frameCount {
            while !input.isReadyForMoreMediaData {
                try Task.checkCancellation()
                guard writer.status == .writing else {
                    throw writer.error ?? NativeMomentError.message("The intro export stopped.")
                }
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            try Task.checkCancellation()
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
            context.interpolationQuality = .high

            // Ease the full square artwork from 92% to 100% scale while it fades in.
            // It never grows beyond its letterboxed bounds, so no artwork is cropped.
            let progress = frameCount > 1 ? Double(frame) / Double(frameCount - 1) : 1
            let eased = 1 - pow(1 - progress, 3)
            let scale = CGFloat(0.92 + 0.08 * eased)
            let opacity = min(1, progress / 0.12)
            let animatedSide = side * scale
            context.saveGState()
            context.setAlpha(CGFloat(opacity))
            context.draw(image, in: CGRect(
                x: (size.width - animatedSide) / 2,
                y: (size.height - animatedSide) / 2,
                width: animatedSide,
                height: animatedSide
            ))
            context.restoreGState()
            CVPixelBufferUnlockBaseAddress(buffer, [])
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
