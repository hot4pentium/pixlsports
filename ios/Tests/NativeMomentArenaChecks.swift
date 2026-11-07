import AVFoundation
import CoreGraphics
import Foundation

extension NativeMomentExportChecks {
    @MainActor
    static func checkIntroReplacement(root: URL, source: URL, directory: URL) async throws {
        let exporter = NativeMomentExporter()
        let plan = try NativeMomentPlan(sourceDuration: 20, start: 3, footage: 0.5, intro: 2.5)
        var outputs = Set<URL>()
        for resource in ["RecordMomentClutch", "RecordMomentDomination", "RecordMomentGameChanger"] {
            let selected = root.appendingPathComponent("ios/PIXL Sports/\(resource).mp4")
            let output = try await exporter.export(source: source, plan: plan,
                                                   directory: directory, shoutoutVideo: selected)
            precondition(outputs.insert(output).inserted, "An intro change reused a previous output file")
            let asset = AVURLAsset(url: output)
            let track = try await asset.loadTracks(withMediaType: .video).first!
            let size = try await track.load(.naturalSize)
            let result = AVAssetImageGenerator(asset: asset)
            let expected = AVAssetImageGenerator(asset: AVURLAsset(url: selected))
            result.appliesPreferredTrackTransform = true
            expected.appliesPreferredTrackTransform = true
            result.requestedTimeToleranceBefore = .zero
            result.requestedTimeToleranceAfter = .zero
            expected.requestedTimeToleranceBefore = .zero
            expected.requestedTimeToleranceAfter = .zero
            let reference = fittedVideoFrame(try frame(expected, at: 1), size: size)
            precondition(distance(signature(try frame(result, at: 1)), signature(reference)) < 0.08,
                         "A recreated clip retained the previous intro instead of \(resource)")
            let original = AVAssetImageGenerator(asset: AVURLAsset(url: source))
            original.appliesPreferredTrackTransform = true
            original.requestedTimeToleranceBefore = .zero
            original.requestedTimeToleranceAfter = .zero
            precondition(
                distance(signature(try frame(result, at: plan.total - 0.1)),
                         signature(try frame(original, at: plan.start + plan.footage - 0.1))) < 0.08,
                "A still image replaced the final footage after \(resource)"
            )
            let duration = try await asset.load(.duration).seconds
            precondition(abs(duration - plan.total) < 0.12, "A trailing still extended the exported clip")
        }
        print("PASS: sequential intro replacement uses only the newly selected animation")
    }

    @MainActor
    static func checkArenaFrames(
        fixtures: [(String, URL)], directory: URL,
        intro: URL, portraitIntro: URL
    ) async throws {
        for (name, source) in fixtures {
            let plan = try NativeMomentPlan(sourceDuration: 20, start: 3, footage: 1, intro: 2.5)
            let output = try await NativeMomentExporter().export(
                source: source, plan: plan, directory: directory,
                shoutoutVideo: intro, shoutoutVideoPortrait: portraitIntro, arenaFrameEnabled: true
            )
            let asset = AVURLAsset(url: output)
            let duration = try await asset.load(.duration).seconds
            precondition(abs(duration - plan.total) < 0.12, "Arena frame changed clip timing")
            let track = try await asset.loadTracks(withMediaType: .video).first!
            let size = try await track.load(.naturalSize)
            let opening = NativeMomentArenaFrame.footageRect(in: size)
            precondition(abs(opening.width / opening.height - size.width / size.height) < 0.001,
                         "Arena frame changed the footage aspect ratio")
            let graphic = try NativeMomentArenaFrame.image(size: size)
            precondition(graphic.width == Int(size.width) && graphic.height == Int(size.height),
                         "Arena frame did not match the video canvas")
            let result = AVAssetImageGenerator(asset: asset)
            let original = AVAssetImageGenerator(asset: AVURLAsset(url: source))
            for generator in [result, original] {
                generator.appliesPreferredTrackTransform = true
                generator.requestedTimeToleranceBefore = .zero
                generator.requestedTimeToleranceAfter = .zero
            }
            let rendered = try frame(result, at: plan.intro + 0.5)
            let selected = try frame(original, at: plan.start + 0.5)
            let safeOpening = opening.insetBy(dx: 1, dy: 1).integral
            guard let inside = rendered.cropping(to: safeOpening) else {
                preconditionFailure("Arena frame's footage opening was unreadable")
            }
            precondition(distance(signature(inside), signature(selected)) < 0.10,
                         "Arena frame cropped or obscured the \(name) footage")
            let edge = CGPoint(x: size.width * 0.5, y: size.height * 0.015)
            precondition(distance(pixelSignature(rendered, at: edge),
                                  pixelSignature(selected, at: edge)) > 0.08,
                         "Arena border was missing from \(name)")
            let expectedIntroURL = size.height > size.width ? portraitIntro : intro
            let expectedIntro = AVAssetImageGenerator(asset: AVURLAsset(url: expectedIntroURL))
            expectedIntro.appliesPreferredTrackTransform = true
            expectedIntro.requestedTimeToleranceBefore = .zero
            expectedIntro.requestedTimeToleranceAfter = .zero
            let introReference = fittedVideoFrame(try frame(expectedIntro, at: 1), size: size)
            precondition(distance(signature(try frame(result, at: 1)), signature(introReference)) < 0.08,
                         "Arena border appeared over the animated intro")
        }
        print("PASS: Arena frame surrounds full portrait, landscape, 4:3, and square footage")
    }
}
