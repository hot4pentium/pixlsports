import AVFoundation
import CoreGraphics
import ImageIO

/// Runs the production exporter against actual Apple-encoded MP4s on macOS.
/// No accounts, Photos library, network, or personal video required.
@main
struct NativeMomentExportChecks {
    @MainActor
    static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let animatedURL = root.appendingPathComponent("ios/PIXL Sports/RecordMomentClutch.mp4")
        let portraitAnimatedURL = root.appendingPathComponent("ios/PIXL Sports/RecordMomentClutchPortrait.mp4")
        let introVideos = [
            ("Clutch", "RecordMomentClutch", "RecordMomentClutchPortrait", CGFloat(16) / 9),
            ("Domination", "RecordMomentDomination", "RecordMomentDominationPortrait", CGFloat(16) / 9),
            ("Game Changer", "RecordMomentGameChanger", "RecordMomentGameChangerPortrait", CGFloat(16) / 9),
            ("Highlight", "RecordMomentHighlight", "RecordMomentHighlightPortrait", CGFloat(16) / 9),
            ("Hustle", "RecordMomentHustle", "RecordMomentHustlePortrait", CGFloat(16) / 9),
            ("Locked In", "RecordMomentLockedIn", "RecordMomentLockedInPortrait", CGFloat(16) / 9),
            ("Unstoppable", "RecordMomentUnstoppable", "RecordMomentUnstoppablePortrait", CGFloat(16) / 9)
        ]
        for (title, landscapeName, portraitName, sourceAspectRatio) in introVideos {
            let landscapeURL = root.appendingPathComponent("ios/PIXL Sports/\(landscapeName).mp4")
            let portraitURL = root.appendingPathComponent("ios/PIXL Sports/\(portraitName).mp4")
            for (url, isPortrait) in [(landscapeURL, false), (portraitURL, true)] {
                precondition(FileManager.default.fileExists(atPath: url.path),
                             "\(title) intro video is missing")
                let introAsset = AVURLAsset(url: url)
                let duration = try await introAsset.load(.duration).seconds
                precondition(duration >= 2.5, "\(title) intro is shorter than the selected duration")
                let tracks = try await introAsset.loadTracks(withMediaType: .video)
                precondition(!tracks.isEmpty, "\(title) intro has no video track")
                let size = try await tracks[0].load(.naturalSize)
                precondition(isPortrait ? size.height > size.width : size.width >= size.height,
                             "\(title) intro has the wrong orientation")
                let audioTracks = try await introAsset.loadTracks(withMediaType: .audio)
                precondition(audioTracks.isEmpty,
                             "\(title) intro should use Stadium Ignition, not its embedded audio")
            }
            let landscapeGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: landscapeURL))
            landscapeGenerator.appliesPreferredTrackTransform = true
            landscapeGenerator.requestedTimeToleranceBefore = .zero
            landscapeGenerator.requestedTimeToleranceAfter = .zero
            let portraitGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: portraitURL))
            portraitGenerator.appliesPreferredTrackTransform = true
            portraitGenerator.requestedTimeToleranceBefore = .zero
            portraitGenerator.requestedTimeToleranceAfter = .zero
            for timestamp in [0.5, 1.25, 2.25] {
                let landscapeFrame = try frame(landscapeGenerator, at: timestamp)
                let portraitFrame = try frame(portraitGenerator, at: timestamp)
                precondition(
                    distance(
                        signature(centeredContentFrame(portraitFrame, aspectRatio: sourceAspectRatio)),
                        signature(landscapeFrame)
                    ) < 0.1,
                    "\(title) portrait intro crops or changes its animation at \(timestamp)s"
                )
            }
        }
        let source = try await fixture(directory: directory, seconds: 20, rotated: false, audio: true)
        let portrait = try await fixture(directory: directory, seconds: 20, rotated: true, audio: true)
        let fourThree = try await fixture(
            directory: directory, seconds: 20, rotated: false, audio: true,
            videoSize: CGSize(width: 320, height: 240)
        )
        let square = try await fixture(
            directory: directory, seconds: 20, rotated: false, audio: true,
            videoSize: CGSize(width: 320, height: 320)
        )
        let tallThreeFour = try await fixture(
            directory: directory, seconds: 20, rotated: false, audio: true,
            videoSize: CGSize(width: 240, height: 320)
        )
        let silent = try await fixture(directory: directory, seconds: 0.4, rotated: false, audio: false)
        for (name, url, start, footage, intro, isPortrait, audible) in [
            ("landscape", source, 3.0, 15.0, 2.0, false, true),
            ("portrait", portrait, 3.0, 15.0, 2.0, true, true),
            ("full-animation-intro", source, 3.0, 15.0, 2.5, false, true),
            ("short-silent", silent, 0.0, 0.4, 2.0, false, false)
        ] {
            let exporter = NativeMomentExporter()
            let plan = try NativeMomentPlan(sourceDuration: start + footage + (footage == 15 ? 2 : 0), start: start, footage: footage, intro: intro)
            let output = try await exporter.export(
                source: url, plan: plan, directory: directory,
                shoutoutVideo: animatedURL, shoutoutVideoPortrait: portraitAnimatedURL
            )
            let asset = AVURLAsset(url: output)
            let actual = try await asset.load(.duration).seconds
            precondition(abs(actual - plan.total) < 0.12, "Actual MP4 duration differs")
            let track = try await asset.loadTracks(withMediaType: .video).first!
            let size = try await track.load(.naturalSize)
            precondition(isPortrait ? size.height > size.width : size.width > size.height)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.requestedTimeToleranceBefore = .zero
            generator.requestedTimeToleranceAfter = .zero
            let sourceGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            sourceGenerator.appliesPreferredTrackTransform = true
            sourceGenerator.requestedTimeToleranceBefore = .zero
            sourceGenerator.requestedTimeToleranceAfter = .zero
            // Compare first/last action frames to corresponding source frames, not just duration.
            for relative in [0.1, max(0.1, footage - 0.1)] {
                let resultFrame = try frame(generator, at: plan.intro + relative)
                let sourceFrame = try frame(sourceGenerator, at: start + relative)
                precondition(distance(signature(resultFrame), signature(sourceFrame)) < 0.08,
                             "Selected start/end footage or orientation changed")
            }
            let earlyIntro = try frame(generator, at: 0.1)
            let lateIntro = try frame(generator, at: plan.intro - 0.1)
            precondition(distance(signature(earlyIntro), signature(lateIntro)) > 0.002,
                         "The shoutout intro did not animate")
            let introGenerator = AVAssetImageGenerator(asset: AVURLAsset(
                url: isPortrait ? portraitAnimatedURL : animatedURL
            ))
            introGenerator.appliesPreferredTrackTransform = true
            introGenerator.requestedTimeToleranceBefore = .zero
            introGenerator.requestedTimeToleranceAfter = .zero
            let expected = fittedVideoFrame(try frame(introGenerator, at: plan.intro - 0.1), size: size)
            precondition(distance(signature(lateIntro), signature(expected)) < 0.08,
                          "The selected animation was replaced by still artwork")
            let audioTracks = try await asset.loadTracks(withMediaType: .audio)
            precondition(audioTracks.isEmpty != audible, "Audio presence changed")
            if audible {
                let audio = audioTracks[0]
                let range = try await audio.load(.timeRange)
                precondition(range.start.seconds <= plan.intro + 0.1, "Audio begins after the selected footage")
                // An MP4 may represent the intro's empty audio interval as AAC silence.
                let introSamples = try samples(asset: asset, track: audio, at: 0.5)
                if !introSamples.isEmpty {
                    let energy = introSamples.map { abs(Double($0)) }.reduce(0, +) / Double(introSamples.count)
                    precondition(energy < 50, "Source audio played during the intro")
                }
                let firstFrequency = try frequency(asset: asset, track: audio, at: plan.intro + 0.25)
                let tailFrequency = try frequency(asset: asset, track: audio, at: plan.intro + 14.5)
                precondition(abs(firstFrequency - 880) < 50, "Beginning audio changed")
                precondition(abs(tailFrequency - 1760) < 80, "Selected tail audio missing or shortened")
                try checkSourceFadeIn(asset: asset, track: audio, start: plan.intro)
            }
            print("PASS: \(name), actual MP4 \(actual)s, ordered intact intro, first/last selected frames, orientation, audio=\(audible)")
        }
        precondition(FileManager.default.fileExists(atPath: animatedURL.path), "Bundled Clutch video is missing")
        precondition(FileManager.default.fileExists(atPath: portraitAnimatedURL.path),
                     "Bundled portrait Clutch video is missing")
        for (name, url, isPortrait) in [
            ("animated-clutch-landscape", source, false),
            ("animated-clutch-portrait", portrait, true)
        ] {
            let start = 3.0
            let plan = try NativeMomentPlan(sourceDuration: 20, start: start, footage: 15, intro: 2.5)
            let output = try await NativeMomentExporter().export(
                source: url,
                plan: plan,
                directory: directory,
                shoutoutVideo: animatedURL,
                shoutoutVideoPortrait: portraitAnimatedURL
            )
            let asset = AVURLAsset(url: output)
            let actual = try await asset.load(.duration).seconds
            precondition(abs(actual - 17.5) < 0.12, "Animated intro reduced the selected footage")
            let videoTrack = try await asset.loadTracks(withMediaType: .video).first!
            let size = try await videoTrack.load(.naturalSize)
            precondition(isPortrait ? size.height > size.width : size.width > size.height)

            let resultGenerator = AVAssetImageGenerator(asset: asset)
            resultGenerator.appliesPreferredTrackTransform = true
            resultGenerator.requestedTimeToleranceBefore = .zero
            resultGenerator.requestedTimeToleranceAfter = .zero
            let introURL = isPortrait ? portraitAnimatedURL : animatedURL
            let introGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: introURL))
            introGenerator.appliesPreferredTrackTransform = true
            introGenerator.requestedTimeToleranceBefore = .zero
            introGenerator.requestedTimeToleranceAfter = .zero
            let sourceGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            sourceGenerator.appliesPreferredTrackTransform = true
            sourceGenerator.requestedTimeToleranceBefore = .zero
            sourceGenerator.requestedTimeToleranceAfter = .zero
            let expectedIntro = fittedVideoFrame(try frame(introGenerator, at: 0.5), size: size)
            let actualIntro = try frame(resultGenerator, at: 0.5)
            precondition(distance(signature(actualIntro), signature(expectedIntro)) < 0.1,
                         "Animated shoutout was cropped or not centered in \(name)")
            if isPortrait {
                let landscapeGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: animatedURL))
                landscapeGenerator.appliesPreferredTrackTransform = true
                landscapeGenerator.requestedTimeToleranceBefore = .zero
                landscapeGenerator.requestedTimeToleranceAfter = .zero
                for timestamp in [0.5, 1.25, 2.25] {
                    let portraitFrame = try frame(introGenerator, at: timestamp)
                    let originalFrame = try frame(landscapeGenerator, at: timestamp)
                    precondition(
                        distance(signature(centeredContentFrame(portraitFrame)), signature(originalFrame)) < 0.1,
                        "Portrait Clutch text or animation was cropped at \(timestamp)s"
                    )
                }
            }
            for relative in [0.1, 14.9] {
                let resultFrame = try frame(resultGenerator, at: plan.intro + relative)
                let sourceFrame = try frame(sourceGenerator, at: start + relative)
                precondition(distance(signature(resultFrame), signature(sourceFrame)) < 0.08,
                             "Animated intro changed selected action in \(name)")
            }
            let audioTrack = try await asset.loadTracks(withMediaType: .audio).first!
            let audioRange = try await audioTrack.load(.timeRange)
            precondition(audioRange.start.seconds <= plan.intro + 0.12,
                         "Original audio begins after the selected footage")
            let introSamples = try samples(asset: asset, track: audioTrack, at: 0.5)
            if !introSamples.isEmpty {
                let introEnergy = introSamples.map { abs(Double($0)) }.reduce(0, +) / Double(introSamples.count)
                precondition(introEnergy < 50, "The animated intro unexpectedly contains source audio")
            }
            let firstFrequency = try frequency(asset: asset, track: audioTrack, at: plan.intro + 0.25)
            let tailFrequency = try frequency(asset: asset, track: audioTrack, at: plan.intro + 14.5)
            precondition(abs(firstFrequency - 880) < 60,
                         "Original audio did not start with the selected footage")
            precondition(abs(tailFrequency - 1760) < 100,
                         "Original tail audio was shortened by the animated intro")
            print("PASS: \(name), bundled silent video intro, full 15-second footage, uncropped layout, source audio")
        }
        let graphitePortraitURL = root.appendingPathComponent(
            "ios/PIXL Sports/Assets.xcassets/GraphiteFramePortrait.imageset/Graphite_Frame_Portrait.png"
        )
        let graphiteLandscapeURL = root.appendingPathComponent(
            "ios/PIXL Sports/Assets.xcassets/GraphiteFrameLandscape.imageset/Graphite_Frame_Landscape.png"
        )
        let graphitePortraitSource = CGImageSourceCreateWithURL(graphitePortraitURL as CFURL, nil)!
        let graphiteLandscapeSource = CGImageSourceCreateWithURL(graphiteLandscapeURL as CFURL, nil)!
        let graphitePortrait = CGImageSourceCreateImageAtIndex(graphitePortraitSource, 0, nil)!
        let graphiteLandscape = CGImageSourceCreateImageAtIndex(graphiteLandscapeSource, 0, nil)!
        for (name, url, frameImage, isPortrait, sourceAspectRatio) in [
            ("landscape", source, graphiteLandscape, false, CGFloat(16) / 9),
            ("portrait", portrait, graphitePortrait, true, CGFloat(9) / 16),
            ("4:3", fourThree, graphiteLandscape, false, CGFloat(4) / 3),
            ("3:4", tallThreeFour, graphitePortrait, true, CGFloat(3) / 4),
            ("square", square, graphiteLandscape, false, CGFloat(1))
        ] {
            let plan = try NativeMomentPlan(sourceDuration: 20, start: 3, footage: 15, intro: 2.5)
            let output = try await NativeMomentExporter().export(
                source: url,
                plan: plan,
                directory: directory,
                shoutoutVideo: animatedURL,
                shoutoutVideoPortrait: portraitAnimatedURL,
                footageFrame: frameImage
            )
            let asset = AVURLAsset(url: output)
            let outputDuration = try await asset.load(.duration).seconds
            precondition(abs(outputDuration - plan.total) < 0.12,
                         "Graphite frame changed the finished video duration")
            let outputAudioTracks = try await asset.loadTracks(withMediaType: .audio)
            precondition(!outputAudioTracks.isEmpty,
                         "Graphite frame removed the original audio")
            let resultGenerator = AVAssetImageGenerator(asset: asset)
            resultGenerator.appliesPreferredTrackTransform = true
            resultGenerator.requestedTimeToleranceBefore = .zero
            resultGenerator.requestedTimeToleranceAfter = .zero
            let sourceGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            sourceGenerator.appliesPreferredTrackTransform = true
            sourceGenerator.requestedTimeToleranceBefore = .zero
            sourceGenerator.requestedTimeToleranceAfter = .zero
            let introGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: isPortrait ? portraitAnimatedURL : animatedURL))
            introGenerator.appliesPreferredTrackTransform = true
            introGenerator.requestedTimeToleranceBefore = .zero
            introGenerator.requestedTimeToleranceAfter = .zero
            let outputTrack = try await asset.loadTracks(withMediaType: .video).first!
            let outputSize = try await outputTrack.load(.naturalSize)
            precondition(
                abs(outputSize.width / outputSize.height - sourceAspectRatio) < 0.01,
                "Graphite export changed the \(name) source proportions"
            )
            let expectedIntro = fittedVideoFrame(try frame(introGenerator, at: 0.5), size: outputSize)
            precondition(
                distance(signature(try frame(resultGenerator, at: 0.5)), signature(expectedIntro)) < 0.1,
                "Graphite frame appeared during the shoutout intro"
            )
            let outputFootage = try frame(resultGenerator, at: plan.intro + 2)
            let sourceFootage = try frame(sourceGenerator, at: 5)
            let center = CGPoint(x: CGFloat(outputFootage.width) / 2, y: CGFloat(outputFootage.height) / 2)
            precondition(
                distance(pixelSignature(outputFootage, at: center), pixelSignature(sourceFootage, at: center)) < 0.08,
                "The transparent opening did not reveal the original footage"
            )
            let frameRect = aspectFitRect(
                imageSize: CGSize(width: frameImage.width, height: frameImage.height),
                inside: CGRect(origin: .zero, size: outputSize)
            )
            let frameEdge = CGPoint(
                x: frameRect.midX / outputSize.width,
                y: (frameRect.minY + max(2, frameRect.height * 0.02)) / outputSize.height
            )
            precondition(
                normalizedPixelDifference(outputFootage, sourceFootage, at: frameEdge) > 0.1,
                "The Graphite frame was missing from the selected footage"
            )
            for point in [
                CGPoint(x: 0.2, y: 0.2),
                CGPoint(x: 0.8, y: 0.8)
            ] {
                precondition(
                    normalizedPixelDifference(outputFootage, sourceFootage, at: point) < 0.08,
                    "Graphite cropped source action in the \(name) export"
                )
            }
            if name == "4:3" || name == "square" {
                // The 16:9 frame is centered, not stretched; footage remains visible
                // in the unframed top and bottom margins.
                for y in [outputSize.height * 0.04, outputSize.height * 0.96] {
                    let marginPoint = CGPoint(x: 0.5, y: y / outputSize.height)
                    precondition(
                        normalizedPixelDifference(outputFootage, sourceFootage, at: marginPoint) < 0.08,
                        "The \(name) frame margin obscured or letterboxed the source footage"
                    )
                }
            }
            if name == "3:4" {
                // The supplied 9:16 portrait frame fits by height, leaving action
                // visible on BOTH sides. Sample asymmetric source corners too:
                // a centered crop or black side bars must not pass as a full fit.
                precondition(frameRect.minX > 0 && frameRect.maxX < outputSize.width,
                             "The 3:4 portrait frame must leave visible side margins")
                for relative in [0.1, 14.9] {
                    let resultFrame = try frame(resultGenerator, at: plan.intro + relative)
                    let sourceFrame = try frame(sourceGenerator, at: plan.start + relative)
                    for x in [CGFloat(0.04), CGFloat(0.96)] {
                        for y in [CGFloat(0.1), CGFloat(0.9)] {
                            precondition(
                                normalizedPixelDifference(resultFrame, sourceFrame, at: CGPoint(x: x, y: y)) < 0.08,
                                "Graphite cropped or obscured the 3:4 source side margins at \(relative)s"
                            )
                        }
                    }
                }
            }
        }
        print("PASS: Graphite frame fits landscape, portrait, 4:3, tall 3:4, and square footage without cropping or stretching")
        try await checkIntroReplacement(root: root, source: source, directory: directory)
        try await checkArenaFrames(
            fixtures: [("landscape", source), ("portrait", portrait), ("4:3", fourThree), ("square", square)],
            directory: directory, intro: animatedURL, portraitIntro: portraitAnimatedURL
        )
        let introMusicURL = root.appendingPathComponent("ios/PIXL Sports/RecordMomentClutchIntroMusic.m4a")
        precondition(FileManager.default.fileExists(atPath: introMusicURL.path), "Bundled intro music is missing")
        let musicPlan = try NativeMomentPlan(sourceDuration: 20, start: 3, footage: 15, intro: 2.5)
        let musicOutput = try await NativeMomentExporter().export(
            source: source,
            plan: musicPlan,
            directory: directory,
            shoutoutVideo: animatedURL,
            introMusicURL: introMusicURL
        )
        let musicAsset = AVURLAsset(url: musicOutput)
        let musicDuration = try await musicAsset.load(.duration).seconds
        precondition(abs(musicDuration - 17.5) < 0.12, "Intro music changed the finished duration")
        let mixedTrack = try await musicAsset.loadTracks(withMediaType: .audio).first!
        let introSamples = try samples(asset: musicAsset, track: mixedTrack, at: 0.5)
        let introEnergy = introSamples.map { abs(Double($0)) }.reduce(0, +) / Double(introSamples.count)
        precondition(introEnergy > 100, "The intro music was not audible")
        let fadeGapSamples = try samples(asset: musicAsset, track: mixedTrack, at: musicPlan.intro - 0.07, duration: 0.05)
        let fadeGapEnergy = fadeGapSamples.map { abs(Double($0)) }.reduce(0, +)
            / Double(max(1, fadeGapSamples.count))
        precondition(fadeGapSamples.isEmpty || fadeGapEnergy < 100,
                     "Intro music overlapped the original clip audio")
        let firstFrequency = try frequency(asset: musicAsset, track: mixedTrack, at: musicPlan.intro + 0.25)
        let tailFrequency = try frequency(asset: musicAsset, track: mixedTrack, at: musicPlan.intro + 14.5)
        precondition(abs(firstFrequency - 880) < 60,
                     "Original source audio did not start after intro music")
        precondition(abs(tailFrequency - 1760) < 100,
                     "Original tail audio was shortened or covered by intro music")
        try checkSourceFadeIn(asset: musicAsset, track: mixedTrack, start: musicPlan.intro)
        print("PASS: intro music fades before source audio; original source audio starts and remains intact")

        let dominationURL = root.appendingPathComponent("ios/PIXL Sports/RecordMomentDomination.mp4")
        let portraitDominationURL = root.appendingPathComponent("ios/PIXL Sports/RecordMomentDominationPortrait.mp4")
        precondition(FileManager.default.fileExists(atPath: dominationURL.path),
                     "Bundled Domination video is missing")
        precondition(FileManager.default.fileExists(atPath: portraitDominationURL.path),
                     "Bundled portrait Domination video is missing")
        let dominationOutput = try await NativeMomentExporter().export(
            source: portrait,
            plan: musicPlan,
            directory: directory,
            shoutoutVideo: dominationURL,
            shoutoutVideoPortrait: portraitDominationURL,
            introMusicURL: introMusicURL
        )
        let dominationAsset = AVURLAsset(url: dominationOutput)
        let dominationDuration = try await dominationAsset.load(.duration).seconds
        precondition(abs(dominationDuration - 17.5) < 0.12,
                     "Domination intro music changed the finished duration")
        let dominationVideo = try await dominationAsset.loadTracks(withMediaType: .video).first!
        let dominationSize = try await dominationVideo.load(.naturalSize)
        precondition(dominationSize.height > dominationSize.width,
                     "Portrait Domination footage did not produce a portrait MP4")
        let dominationOutputGenerator = AVAssetImageGenerator(asset: dominationAsset)
        dominationOutputGenerator.appliesPreferredTrackTransform = true
        dominationOutputGenerator.requestedTimeToleranceBefore = .zero
        dominationOutputGenerator.requestedTimeToleranceAfter = .zero
        let dominationIntroGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: portraitDominationURL))
        dominationIntroGenerator.appliesPreferredTrackTransform = true
        dominationIntroGenerator.requestedTimeToleranceBefore = .zero
        dominationIntroGenerator.requestedTimeToleranceAfter = .zero
        let expectedDominationFrame = fittedVideoFrame(
            try frame(dominationIntroGenerator, at: 1.0),
            size: dominationSize
        )
        let actualDominationFrame = try frame(dominationOutputGenerator, at: 1.0)
        precondition(distance(signature(actualDominationFrame), signature(expectedDominationFrame)) < 0.1,
                     "Domination animation was not used in the music test export")
        let landscapeDominationGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: dominationURL))
        landscapeDominationGenerator.appliesPreferredTrackTransform = true
        landscapeDominationGenerator.requestedTimeToleranceBefore = .zero
        landscapeDominationGenerator.requestedTimeToleranceAfter = .zero
        for timestamp in [0.5, 1.5, 2.25] {
            let portraitFrame = try frame(dominationIntroGenerator, at: timestamp)
            let originalFrame = try frame(landscapeDominationGenerator, at: timestamp)
            precondition(
                distance(
                    signature(centeredContentFrame(portraitFrame, aspectRatio: CGFloat(16) / 9)),
                    signature(originalFrame)
                ) < 0.1,
                "Portrait Domination text or animation was cropped at \(timestamp)s"
            )
        }
        let dominationAudio = try await dominationAsset.loadTracks(withMediaType: .audio).first!
        let dominationIntroSamples = try samples(asset: dominationAsset, track: dominationAudio, at: 0.5)
        let dominationIntroEnergy = dominationIntroSamples.map { abs(Double($0)) }.reduce(0, +)
            / Double(max(1, dominationIntroSamples.count))
        precondition(dominationIntroEnergy > 100, "Domination intro music was not audible")
        let dominationFirstFrequency = try frequency(
            asset: dominationAsset, track: dominationAudio, at: musicPlan.intro + 0.25
        )
        precondition(abs(dominationFirstFrequency - 880) < 60,
                     "Original audio did not begin after Domination intro music")
        print("PASS: animated Domination with Stadium Ignition music and original audio")

        // Cancellation must stop work and remove all unfinished exporter files.
        let exporter = NativeMomentExporter()
        let baseline = Set(try FileManager.default.contentsOfDirectory(atPath: directory.path))
        let task = Task { @MainActor in
            try await exporter.export(source: source,
                plan: NativeMomentPlan(sourceDuration: 20, start: 3, footage: 15),
                directory: directory, shoutoutVideo: animatedURL)
        }
        task.cancel()
        do { _ = try await task.value; preconditionFailure("Cancelled export succeeded") }
        catch is CancellationError {}
        let after = Set(try FileManager.default.contentsOfDirectory(atPath: directory.path))
        precondition(after == baseline, "Cancelled export left temporary output")
        let invalid = directory.appendingPathComponent("invalid.mov")
        try Data("not video".utf8).write(to: invalid)
        do {
            _ = try await NativeMomentExporter().export(source: invalid,
                plan: NativeMomentPlan(sourceDuration: 20, start: 0, footage: 15),
                directory: directory, shoutoutVideo: animatedURL)
            preconditionFailure("Invalid media succeeded")
        } catch {}
        let remainingFiles = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        precondition(!remainingFiles.contains { $0.hasPrefix("intro-") })
        print("PASS: cancellation, invalid media, temporary intro cleanup")
        print("MP4 evidence saved in \(directory.path). Photos, native share targets, and camera still require iPhone checks.")
    }

    static func frame(_ generator: AVAssetImageGenerator, at seconds: Double) throws -> CGImage {
        try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil)
    }

    /// 8x8 RGB signature checks letterboxing and top/bottom orientation, not just a mean color.
    static func signature(_ image: CGImage) -> [Double] {
        var bytes = [UInt8](repeating: 0, count: 8 * 8 * 4)
        bytes.withUnsafeMutableBytes { ptr in
            let context = CGContext(data: ptr.baseAddress, width: 8, height: 8, bitsPerComponent: 8,
                bytesPerRow: 32, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        return bytes.enumerated().filter { $0.offset % 4 != 3 }.map { Double($0.element) / 255 }
    }

    static func distance(_ a: [Double], _ b: [Double]) -> Double {
        zip(a, b).map { abs($0 - $1) }.reduce(0, +) / Double(a.count)
    }

    static func pixelSignature(_ image: CGImage, at point: CGPoint) -> [Double] {
        let x = min(max(0, Int(point.x)), image.width - 1)
        let y = min(max(0, Int(point.y)), image.height - 1)
        guard let pixel = image.cropping(to: CGRect(x: CGFloat(x), y: CGFloat(y), width: 1, height: 1)) else {
            preconditionFailure("Unable to sample exported video frame")
        }
        return signature(pixel)
    }

    static func normalizedPixelDifference(_ first: CGImage, _ second: CGImage, at point: CGPoint) -> Double {
        let firstPoint = CGPoint(
            x: point.x * CGFloat(first.width),
            y: point.y * CGFloat(first.height)
        )
        let secondPoint = CGPoint(
            x: point.x * CGFloat(second.width),
            y: point.y * CGFloat(second.height)
        )
        return distance(pixelSignature(first, at: firstPoint), pixelSignature(second, at: secondPoint))
    }

    static func aspectFitRect(imageSize: CGSize, inside bounds: CGRect) -> CGRect {
        let scale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
        let fittedSize = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: bounds.midX - fittedSize.width / 2,
            y: bounds.midY - fittedSize.height / 2,
            width: fittedSize.width,
            height: fittedSize.height
        )
    }

    static func graphicFrame(_ image: CGImage, size: CGSize) -> CGImage {
        let context = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.fill(CGRect(origin: .zero, size: size))
        let side = min(size.width, size.height)
        context.draw(image, in: CGRect(x: (size.width - side) / 2, y: (size.height - side) / 2, width: side, height: side))
        return context.makeImage()!
    }

    static func fittedVideoFrame(_ image: CGImage, size: CGSize) -> CGImage {
        let context = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.fill(CGRect(origin: .zero, size: size))
        let scale = min(size.width / CGFloat(image.width), size.height / CGFloat(image.height))
        let width = CGFloat(image.width) * scale
        let height = CGFloat(image.height) * scale
        context.draw(image, in: CGRect(x: (size.width - width) / 2, y: (size.height - height) / 2,
                                       width: width, height: height))
        return context.makeImage()!
    }

    static func centeredContentFrame(_ image: CGImage, aspectRatio: CGFloat = 16 / 9) -> CGImage {
        let width = CGFloat(image.width)
        let height = width / aspectRatio
        let rect = CGRect(x: 0, y: (CGFloat(image.height) - height) / 2,
                          width: width, height: height).integral
        return image.cropping(to: rect)!
    }

    @MainActor
    static func fixture(
        directory: URL,
        seconds: Double,
        rotated: Bool,
        audio: Bool,
        videoSize: CGSize = CGSize(width: 320, height: 180)
    ) async throws -> URL {
        let raw = directory.appendingPathComponent("fixture-\(UUID()).mp4")
        let writer = try AVAssetWriter(outputURL: raw, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(videoSize.width),
            AVVideoHeightKey: Int(videoSize.height)
        ])
        if rotated {
            input.transform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: videoSize.height, ty: 0)
        }
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: Int(videoSize.width),
            kCVPixelBufferHeightKey as String: Int(videoSize.height)
        ])
        writer.add(input)
        precondition(writer.startWriting())
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<Int(seconds * 30) {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
            var buffer: CVPixelBuffer?
            precondition(CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer) == kCVReturnSuccess)
            CVPixelBufferLockBaseAddress(buffer!, [])
            let context = CGContext(
                data: CVPixelBufferGetBaseAddress(buffer!),
                width: Int(videoSize.width),
                height: Int(videoSize.height),
                bitsPerComponent: 8,
                bytesPerRow: CVPixelBufferGetBytesPerRow(buffer!),
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
            )!
            // Distinct beginning/middle/tail colors, plus asymmetric corners to expose rotation.
            let time = Double(frame) / 30
            context.setFillColor(time < 3 ? CGColor(red: 0.9, green: 0.1, blue: 0.1, alpha: 1)
                : time < 17 ? CGColor(red: 0.1, green: 0.8, blue: 0.2, alpha: 1)
                : CGColor(red: 0.1, green: 0.2, blue: 0.9, alpha: 1))
            context.fill(CGRect(origin: .zero, size: videoSize))
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: videoSize.width / 4, height: videoSize.height / 4))
            context.setFillColor(CGColor(gray: 0, alpha: 1))
            context.fill(CGRect(
                x: videoSize.width * 0.75,
                y: videoSize.height * 0.75,
                width: videoSize.width / 4,
                height: videoSize.height / 4
            ))
            CVPixelBufferUnlockBaseAddress(buffer!, [])
            precondition(adaptor.append(buffer!, withPresentationTime: CMTime(value: Int64(frame), timescale: 30)))
        }
        writer.endSession(atSourceTime: CMTime(seconds: seconds, preferredTimescale: 600))
        input.markAsFinished()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in writer.finishWriting { c.resume() } }
        precondition(writer.status == .completed)
        guard audio else { return raw }
        let wav = directory.appendingPathComponent("tone-\(UUID()).wav")
        try tone(seconds: seconds).write(to: wav)
        let videoAsset = AVURLAsset(url: raw)
        let audioAsset = AVURLAsset(url: wav)
        let sourceVideo = try await videoAsset.loadTracks(withMediaType: .video).first!
        let sourceAudio = try await audioAsset.loadTracks(withMediaType: .audio).first!
        let composition = AVMutableComposition()
        let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
        let sound = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
        let range = CMTimeRange(start: .zero, duration: CMTime(seconds: seconds, preferredTimescale: 600))
        try video.insertTimeRange(range, of: sourceVideo, at: .zero)
        video.preferredTransform = try await sourceVideo.load(.preferredTransform)
        try sound.insertTimeRange(range, of: sourceAudio, at: .zero)
        let output = directory.appendingPathComponent("source-\(UUID()).mp4")
        let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality)!
        session.outputURL = output
        session.outputFileType = .mp4
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in session.exportAsynchronously { c.resume() } }
        precondition(session.status == .completed)
        return output
    }

    static func tone(seconds: Double) -> Data {
        let rate = 44_100
        let count = Int(seconds * Double(rate))
        var data = Data()
        func text(_ value: String) { data.append(contentsOf: value.utf8) }
        func number<T: FixedWidthInteger>(_ value: T) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
        }
        text("RIFF"); number(UInt32(36 + count * 2)); text("WAVEfmt "); number(UInt32(16))
        number(UInt16(1)); number(UInt16(1)); number(UInt32(rate)); number(UInt32(rate * 2))
        number(UInt16(2)); number(UInt16(16)); text("data"); number(UInt32(count * 2))
        for index in 0..<count {
            let time = Double(index) / Double(rate)
            let hz = time < 3 ? 440.0 : time < 17 ? 880.0 : 1760.0
            number(Int16(sin(2 * .pi * hz * time) * 12_000))
        }
        return data
    }

    static func checkSourceFadeIn(asset: AVAsset, track: AVAssetTrack, start: Double) throws {
        let early = try samples(asset: asset, track: track, at: start + 0.02, duration: 0.04)
        let steady = try samples(asset: asset, track: track, at: start + 0.5, duration: 0.04)
        precondition(!early.isEmpty && !steady.isEmpty, "Source fade-in audio could not be decoded")
        let earlyEnergy = early.map { abs(Double($0)) }.reduce(0, +) / Double(early.count)
        let steadyEnergy = steady.map { abs(Double($0)) }.reduce(0, +) / Double(steady.count)
        precondition(earlyEnergy > 1 && steadyEnergy > 1000 && earlyEnergy < steadyEnergy * 0.6,
                     "Source audio did not fade in gently")
    }

    static func frequency(asset: AVAsset, track: AVAssetTrack, at seconds: Double) throws -> Double {
        let samples = try samples(asset: asset, track: track, at: seconds)
        precondition(samples.count > 1000, "Audio decode failed")
        precondition(samples.map { abs(Double($0)) }.reduce(0, +) / Double(samples.count) > 1000, "Audio became silent")
        let positiveCrossings = zip(samples, samples.dropFirst()).filter { $0 < 0 && $1 >= 0 }.count
        return Double(positiveCrossings) * 44100 / Double(samples.count)
    }

    static func samples(asset: AVAsset, track: AVAssetTrack, at seconds: Double, duration: Double = 0.2) throws -> [Int16] {
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(start: CMTime(seconds: seconds, preferredTimescale: 600),
                                      duration: CMTime(seconds: duration, preferredTimescale: 600))
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false, AVNumberOfChannelsKey: 1, AVSampleRateKey: 44100
        ])
        reader.add(output)
        precondition(reader.startReading())
        var samples: [Int16] = []
        while let sample = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
            let length = CMBlockBufferGetDataLength(block)
            var data = Data(count: length)
            _ = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
            for index in stride(from: 0, to: data.count - 1, by: 2) {
                samples.append(Int16(bitPattern: UInt16(data[index]) | UInt16(data[index + 1]) << 8))
            }
        }
        precondition(reader.status == .completed, "Audio decode failed")
        return samples
    }
}
