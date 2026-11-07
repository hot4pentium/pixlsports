import AVFoundation
import CoreGraphics
import QuartzCore

/// All files belong to the caller's disposable workspace. No network or library writes.
@MainActor
final class NativeMomentExporter {
    private var session: AVAssetExportSession?

    func cancel() {
        session?.cancelExport()
    }

    func export(
        source: URL,
        plan: NativeMomentPlan,
        directory: URL,
        shoutoutVideo: URL,
        shoutoutVideoPortrait: URL? = nil,
        introMusicURL: URL? = nil,
        footageFrame: CGImage? = nil,
        arenaFrameEnabled: Bool = false
    ) async throws -> URL {
        defer {
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
        let size = NativeMomentArenaFrame.renderSize(for: oriented.size)
        let introTime = CMTime(seconds: plan.intro, preferredTimescale: 600)
        let selectedURL: URL
        if oriented.height > oriented.width {
            guard let shoutoutVideoPortrait else {
                throw NativeMomentError.message("A portrait version of this animated shoutout isn’t available.")
            }
            selectedURL = shoutoutVideoPortrait
        } else {
            selectedURL = shoutoutVideo
        }
        // Animations are mandatory. There is deliberately no still-image fallback.
        let introURL = directory.appendingPathComponent("intro-\(UUID()).mp4")
        try FileManager.default.copyItem(at: selectedURL, to: introURL)
        defer { try? FileManager.default.removeItem(at: introURL) }
        let introAsset = AVURLAsset(url: introURL)
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
        let footageBounds = arenaFrameEnabled
            ? NativeMomentArenaFrame.footageRect(in: size)
            : CGRect(origin: .zero, size: size)
        let fit = min(footageBounds.width / oriented.width, footageBounds.height / oriented.height)
        let transform = preferredTransform
            .concatenating(CGAffineTransform(translationX: -oriented.minX, y: -oriented.minY))
            .concatenating(CGAffineTransform(scaleX: fit, y: fit))
            .concatenating(CGAffineTransform(
                translationX: footageBounds.midX - oriented.width * fit / 2,
                y: footageBounds.midY - oriented.height * fit / 2))
        layer.setTransform(transform, at: introTime)
        footageInstruction.layerInstructions = [layer]
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = size
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.instructions = [introInstruction, footageInstruction]
        let resolvedFrame = arenaFrameEnabled ? try NativeMomentArenaFrame.image(size: size) : footageFrame
        if let footageFrame = resolvedFrame {
            let parentLayer = CALayer()
            parentLayer.frame = CGRect(origin: .zero, size: size)
            parentLayer.masksToBounds = true

            let videoLayer = CALayer()
            videoLayer.frame = parentLayer.bounds
            parentLayer.addSublayer(videoLayer)

            let frameLayer = CALayer()
            // Preserve the supplied frame's aspect ratio. On 4:3 and square videos,
            // aspect fit leaves source footage visible outside its centered 16:9 bounds.
            frameLayer.frame = aspectFitRect(
                imageSize: CGSize(width: footageFrame.width, height: footageFrame.height),
                inside: parentLayer.bounds
            )
            frameLayer.contents = footageFrame
            frameLayer.contentsGravity = .resize
            frameLayer.opacity = 0
            parentLayer.addSublayer(frameLayer)

            // Begin exactly as the selected footage starts; the intro remains unframed.
            let appear = CABasicAnimation(keyPath: "opacity")
            appear.fromValue = 0
            appear.toValue = 1
            appear.beginTime = AVCoreAnimationBeginTimeAtZero + introTime.seconds
            appear.duration = 1.0 / 30.0
            appear.fillMode = .forwards
            appear.isRemovedOnCompletion = false
            frameLayer.add(appear, forKey: "record-moment-frame-appear")

            let configuration = AVVideoCompositionCoreAnimationTool.Configuration(
                postProcessingAsVideoLayer: videoLayer,
                containingLayer: parentLayer
            )
            videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(configuration: configuration)
        }
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

    private func aspectFitRect(imageSize: CGSize, inside bounds: CGRect) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0,
              bounds.width > 0, bounds.height > 0 else { return bounds }
        let scale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
        let fittedSize = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: bounds.midX - fittedSize.width / 2,
            y: bounds.midY - fittedSize.height / 2,
            width: fittedSize.width,
            height: fittedSize.height
        )
    }

}
