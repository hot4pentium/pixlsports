import AVFoundation
import CoreGraphics
import ImageIO

/// Runs the production exporter against actual Apple-encoded MP4s on macOS.
/// No accounts, Photos library, network, or personal video required.
@main
struct NativeMomentExportChecks {
    static let frameSize = CGSize(width: 320, height: 180)

    @MainActor
    static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let imageURL = root.appendingPathComponent("ios/PIXL Sports/Assets.xcassets/Moment-clutch.imageset/artwork.jpg")
        let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil)!
        let artwork = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)!
        let source = try await fixture(directory: directory, seconds: 20, rotated: false, audio: true)
        let portrait = try await fixture(directory: directory, seconds: 20, rotated: true, audio: true)
        let silent = try await fixture(directory: directory, seconds: 0.4, rotated: false, audio: false)
        for (name, url, start, footage, intro, isPortrait, audible) in [
            ("landscape", source, 3.0, 15.0, 2.0, false, true),
            ("portrait", portrait, 3.0, 15.0, 2.0, true, true),
            ("three-second-intro", source, 3.0, 15.0, 3.0, false, true),
            ("short-silent", silent, 0.0, 0.4, 2.0, false, false)
        ] {
            let exporter = NativeMomentExporter()
            let plan = try NativeMomentPlan(sourceDuration: start + footage + (footage == 15 ? 2 : 0), start: start, footage: footage, intro: intro)
            let output = try await exporter.export(source: url, shoutout: artwork, plan: plan, directory: directory)
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
            let expected = graphicFrame(artwork, size: size)
            precondition(distance(signature(lateIntro), signature(expected)) < 0.08,
                         "Artwork cropped, inverted, or absent at the end of the animation")
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
            }
            print("PASS: \(name), actual MP4 \(actual)s, ordered intact intro, first/last selected frames, orientation, audio=\(audible)")
        }
        let animatedURL = root.appendingPathComponent("ios/PIXL Sports/RecordMomentClutch.mp4")
        precondition(FileManager.default.fileExists(atPath: animatedURL.path), "Bundled Clutch video is missing")
        for (name, url, isPortrait) in [
            ("animated-clutch-landscape", source, false),
            ("animated-clutch-portrait", portrait, true)
        ] {
            let start = 3.0
            let plan = try NativeMomentPlan(sourceDuration: 20, start: start, footage: 15, intro: 2.5)
            let output = try await NativeMomentExporter().export(
                source: url,
                shoutout: artwork,
                plan: plan,
                directory: directory,
                shoutoutVideo: animatedURL
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
            let introGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: animatedURL))
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
        let musicURL = root.appendingPathComponent("ios/PIXL Sports/RecordMomentMusic.m4a")
        precondition(FileManager.default.fileExists(atPath: musicURL.path), "Bundled instrumental is missing")
        let musicPlan = try NativeMomentPlan(sourceDuration: 20, start: 3, footage: 15, intro: 2)
        let musicOutput = try await NativeMomentExporter().export(
            source: source,
            shoutout: artwork,
            plan: musicPlan,
            directory: directory,
            musicURL: musicURL,
            musicVolume: 0.18
        )
        let musicAsset = AVURLAsset(url: musicOutput)
        let musicDuration = try await musicAsset.load(.duration).seconds
        precondition(abs(musicDuration - musicPlan.total) < 0.12, "Music changed the finished duration")
        let mixedTrack = try await musicAsset.loadTracks(withMediaType: .audio).first!
        let introSamples = try samples(asset: musicAsset, track: mixedTrack, at: 0.5)
        let introEnergy = introSamples.map { abs(Double($0)) }.reduce(0, +) / Double(introSamples.count)
        precondition(introEnergy > 100, "Optional music was not audible during the intro")
        let mixedFirstFrequency = try frequency(asset: musicAsset, track: mixedTrack, at: musicPlan.intro + 0.25)
        let mixedTailFrequency = try frequency(asset: musicAsset, track: mixedTrack, at: musicPlan.intro + 14.5)
        precondition(abs(mixedFirstFrequency - 880) < 60,
                     "Original source audio was not preserved under the music")
        precondition(abs(mixedTailFrequency - 1760) < 100,
                     "The selected tail audio was not preserved under the music")
        print("PASS: optional bundled music, source audio retained, soundtrack stays under source audio, unchanged duration")

        // Cancellation must stop work and remove all unfinished exporter files.
        let exporter = NativeMomentExporter()
        let baseline = Set(try FileManager.default.contentsOfDirectory(atPath: directory.path))
        let task = Task { @MainActor in
            try await exporter.export(source: source, shoutout: artwork,
                plan: NativeMomentPlan(sourceDuration: 20, start: 3, footage: 15), directory: directory)
        }
        task.cancel()
        do { _ = try await task.value; preconditionFailure("Cancelled export succeeded") }
        catch is CancellationError {}
        let after = Set(try FileManager.default.contentsOfDirectory(atPath: directory.path))
        precondition(after == baseline, "Cancelled export left temporary output")
        let invalid = directory.appendingPathComponent("invalid.mov")
        try Data("not video".utf8).write(to: invalid)
        do {
            _ = try await NativeMomentExporter().export(source: invalid, shoutout: artwork,
                plan: NativeMomentPlan(sourceDuration: 20, start: 0, footage: 15), directory: directory)
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

    @MainActor
    static func fixture(directory: URL, seconds: Double, rotated: Bool, audio: Bool) async throws -> URL {
        let raw = directory.appendingPathComponent("fixture-\(UUID()).mp4")
        let writer = try AVAssetWriter(outputURL: raw, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 320, AVVideoHeightKey: 180
        ])
        if rotated { input.transform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 180, ty: 0) }
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: 320, kCVPixelBufferHeightKey as String: 180
        ])
        writer.add(input)
        precondition(writer.startWriting())
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<Int(seconds * 30) {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
            var buffer: CVPixelBuffer?
            precondition(CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer) == kCVReturnSuccess)
            CVPixelBufferLockBaseAddress(buffer!, [])
            let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer!), width: 320, height: 180, bitsPerComponent: 8,
                bytesPerRow: CVPixelBufferGetBytesPerRow(buffer!), space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
            // Distinct beginning/middle/tail colors, plus asymmetric corners to expose rotation.
            let time = Double(frame) / 30
            context.setFillColor(time < 3 ? CGColor(red: 0.9, green: 0.1, blue: 0.1, alpha: 1)
                : time < 17 ? CGColor(red: 0.1, green: 0.8, blue: 0.2, alpha: 1)
                : CGColor(red: 0.1, green: 0.2, blue: 0.9, alpha: 1))
            context.fill(CGRect(origin: .zero, size: frameSize))
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 80, height: 45))
            context.setFillColor(CGColor(gray: 0, alpha: 1))
            context.fill(CGRect(x: 240, y: 135, width: 80, height: 45))
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

    static func frequency(asset: AVAsset, track: AVAssetTrack, at seconds: Double) throws -> Double {
        let samples = try samples(asset: asset, track: track, at: seconds)
        precondition(samples.count > 1000, "Audio decode failed")
        precondition(samples.map { abs(Double($0)) }.reduce(0, +) / Double(samples.count) > 1000, "Audio became silent")
        let positiveCrossings = zip(samples, samples.dropFirst()).filter { $0 < 0 && $1 >= 0 }.count
        return Double(positiveCrossings) * 44100 / Double(samples.count)
    }

    static func samples(asset: AVAsset, track: AVAssetTrack, at seconds: Double) throws -> [Int16] {
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(start: CMTime(seconds: seconds, preferredTimescale: 600),
                                      duration: CMTime(seconds: 0.2, preferredTimescale: 600))
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
