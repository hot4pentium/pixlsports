import AVFoundation
import QuartzCore
import CoreGraphics
import CoreTransferable
import Photos
import SwiftUI
import UniformTypeIdentifiers
import UIKit

enum NativeRecordMomentArtwork: String, CaseIterable, Identifiable {
    case clutch = "0_clutch"
    case domination = "1_domination"
    case gameChanger = "2_gamechanger"
    case highlight = "3_highlight"
    case hustle = "4_hustle"
    case lockedIn = "5_lockedin"
    case milestone = "6_milestone"
    case nextLevel = "7_nextlevel"
    case unstoppable = "8_unstoppable"
    case victory = "9_victory"

    var id: String { rawValue }
    var assetName: String { "RecordMomentIntro_\(rawValue)" }

    var title: String {
        switch self {
        case .clutch: return "Clutch"
        case .domination: return "Domination"
        case .gameChanger: return "Game Changer"
        case .highlight: return "Highlight"
        case .hustle: return "Hustle"
        case .lockedIn: return "Locked In"
        case .milestone: return "Milestone"
        case .nextLevel: return "Next Level"
        case .unstoppable: return "Unstoppable"
        case .victory: return "Victory"
        }
    }
}

enum NativeRecordMomentLimits {
    static let maximumSourceBytes = 120 * 1024 * 1024
    static let maximumFootageSeconds = 15.0
    static let minimumFootageSeconds = 0.5

    static func footageLimit(for sourceDuration: Double) -> Double {
        min(max(0, sourceDuration), maximumFootageSeconds)
    }

    static func maximumStart(sourceDuration: Double, footageDuration: Double) -> Double {
        max(0, sourceDuration - footageDuration)
    }

    static func clampedStart(_ start: Double, sourceDuration: Double, footageDuration: Double) -> Double {
        min(max(0, start), maximumStart(sourceDuration: sourceDuration, footageDuration: footageDuration))
    }
}

enum NativeRecordMomentMediaError: LocalizedError {
    case fileTooLarge
    case cannotReadVideo
    case videoTooShort
    case missingArtwork
    case exportUnavailable
    case exportFailed
    case photoAccessDenied
    case photoSaveFailed

    var errorDescription: String? {
        switch self {
        case .fileTooLarge:
            return "Choose a video smaller than 120 MB."
        case .cannotReadVideo:
            return "This video couldn’t be opened. Try choosing another one."
        case .videoTooShort:
            return "Choose a video that is at least half a second long."
        case .missingArtwork:
            return "That shoutout image isn’t available. Choose another one."
        case .exportUnavailable:
            return "This video can’t be prepared on this iPhone. Try another clip."
        case .exportFailed:
            return "The clip couldn’t be made. Your original video is unchanged; try again with another clip."
        case .photoAccessDenied:
            return "Allow PIXL Sports to add videos to Photos in Settings, then try again."
        case .photoSaveFailed:
            return "The video couldn’t be saved to Photos. You can still share the clip."
        }
    }
}

enum NativeRecordMomentFileStorage {
    static func importFile(at sourceURL: URL) throws -> URL {
        let fileValues = try sourceURL.resourceValues(forKeys: [.fileSizeKey])
        guard let fileSize = fileValues.fileSize, fileSize <= NativeRecordMomentLimits.maximumSourceBytes else {
            throw NativeRecordMomentMediaError.fileTooLarge
        }

        let directory = try storageDirectory()
        let fileExtension = sourceURL.pathExtension.isEmpty ? "mov" : sourceURL.pathExtension
        let destination = directory.appendingPathComponent("\(UUID().uuidString).\(fileExtension)")
        try FileManager.default.copyItem(at: sourceURL, to: destination)
        return destination
    }

    static func makeOutputURL() throws -> URL {
        try storageDirectory().appendingPathComponent("\(UUID().uuidString).mp4")
    }

    static func remove(_ url: URL?) {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private static func storageDirectory() throws -> URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("NativeRecordMoments", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}

struct NativeRecordMomentTransferFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { receivedFile in
            NativeRecordMomentTransferFile(
                url: try NativeRecordMomentFileStorage.importFile(at: receivedFile.file)
            )
        }
    }
}

@MainActor
enum NativeRecordMomentExporter {
    static let introDurationRange = 1.0...3.0

    static func export(
        sourceURL: URL,
        startSeconds: Double,
        footageSeconds: Double,
        introSeconds: Double,
        artwork: NativeRecordMomentArtwork
    ) async throws -> (url: URL, aspectRatio: CGFloat) {
        let source = AVURLAsset(url: sourceURL)
        let videoTracks = try await source.loadTracks(withMediaType: .video)
        guard let sourceVideo = videoTracks.first else {
            throw NativeRecordMomentMediaError.cannotReadVideo
        }

        let naturalSize = try await sourceVideo.load(.naturalSize)
        let preferredTransform = try await sourceVideo.load(.preferredTransform)
        let orientedBounds = CGRect(origin: .zero, size: naturalSize)
            .applying(preferredTransform)
            .standardized
        guard orientedBounds.width > 0, orientedBounds.height > 0 else {
            throw NativeRecordMomentMediaError.cannotReadVideo
        }

        let composition = AVMutableComposition()
        guard let compositionVideo = composition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw NativeRecordMomentMediaError.exportUnavailable
        }

        let sourceStart = CMTime(seconds: startSeconds, preferredTimescale: 600)
        let footageDuration = CMTime(seconds: footageSeconds, preferredTimescale: 600)
        let introDuration = CMTime(seconds: introSeconds, preferredTimescale: 600)
        let sourceRange = CMTimeRange(start: sourceStart, duration: footageDuration)
        try compositionVideo.insertTimeRange(sourceRange, of: sourceVideo, at: introDuration)

        if let sourceAudio = try await source.loadTracks(withMediaType: .audio).first,
           let compositionAudio = composition.addMutableTrack(
               withMediaType: .audio,
               preferredTrackID: kCMPersistentTrackID_Invalid
           ) {
            try compositionAudio.insertTimeRange(sourceRange, of: sourceAudio, at: introDuration)
        }

        guard let introImage = UIImage(named: artwork.assetName)?.cgImage else {
            throw NativeRecordMomentMediaError.missingArtwork
        }

        let renderSize = CGSize(
            width: max(2, CGFloat(Int(orientedBounds.width.rounded()) & ~1)),
            height: max(2, CGFloat(Int(orientedBounds.height.rounded()) & ~1))
        )
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)

        var normalizedTransform = preferredTransform.concatenating(
            CGAffineTransform(translationX: -orientedBounds.minX, y: -orientedBounds.minY)
        )
        normalizedTransform = normalizedTransform.concatenating(
            CGAffineTransform(
                scaleX: renderSize.width / orientedBounds.width,
                y: renderSize.height / orientedBounds.height
            )
        )

        let introInstruction = AVMutableVideoCompositionInstruction()
        introInstruction.timeRange = CMTimeRange(start: .zero, duration: introDuration)
        introInstruction.backgroundColor = UIColor(
            red: 0.035, green: 0.075, blue: 0.15, alpha: 1
        ).cgColor

        let clipInstruction = AVMutableVideoCompositionInstruction()
        clipInstruction.timeRange = CMTimeRange(start: introDuration, duration: footageDuration)
        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideo)
        layerInstruction.setTransform(normalizedTransform, at: introDuration)
        clipInstruction.layerInstructions = [layerInstruction]
        videoComposition.instructions = [introInstruction, clipInstruction]

        let parentLayer = CALayer()
        parentLayer.frame = CGRect(origin: .zero, size: renderSize)
        parentLayer.masksToBounds = true

        let videoLayer = CALayer()
        videoLayer.frame = parentLayer.bounds
        parentLayer.addSublayer(videoLayer)

        let introLayer = CALayer()
        introLayer.frame = parentLayer.bounds
        introLayer.contents = introImage
        introLayer.contentsGravity = .resizeAspect
        introLayer.backgroundColor = introInstruction.backgroundColor
        parentLayer.addSublayer(introLayer)

        let fadeOut = CABasicAnimation(keyPath: "opacity")
        fadeOut.fromValue = 1
        fadeOut.toValue = 0
        fadeOut.beginTime = AVCoreAnimationBeginTimeAtZero + introSeconds
        fadeOut.duration = 1.0 / 30.0
        fadeOut.fillMode = .forwards
        fadeOut.isRemovedOnCompletion = false
        introLayer.add(fadeOut, forKey: "record-moment-intro-fade")
        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
            postProcessingAsVideoLayer: videoLayer,
            in: parentLayer
        )

        guard let exporter = AVAssetExportSession(
            asset: composition,
            presetName: AVAssetExportPreset1280x720
        ), exporter.supportedFileTypes?.contains(.mp4) == true else {
            throw NativeRecordMomentMediaError.exportUnavailable
        }

        let outputURL = try NativeRecordMomentFileStorage.makeOutputURL()
        exporter.outputURL = outputURL
        exporter.outputFileType = .mp4
        exporter.shouldOptimizeForNetworkUse = true
        exporter.videoComposition = videoComposition

        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                exporter.exportAsynchronously {
                    switch exporter.status {
                    case .completed:
                        continuation.resume()
                    case .failed, .cancelled:
                        continuation.resume(throwing: exporter.error ?? NativeRecordMomentMediaError.exportFailed)
                    default:
                        continuation.resume(throwing: NativeRecordMomentMediaError.exportFailed)
                    }
                }
            }
        } catch {
            NativeRecordMomentFileStorage.remove(outputURL)
            throw error
        }

        return (outputURL, renderSize.width / max(renderSize.height, 1))
    }
}

enum NativeRecordMomentPhotoSaver {
    static func saveVideo(at url: URL) async throws {
        let status = await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                continuation.resume(returning: status)
            }
        }
        guard status == .authorized else {
            throw NativeRecordMomentMediaError.photoAccessDenied
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
            } completionHandler: { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: NativeRecordMomentMediaError.photoSaveFailed)
                }
            }
        }
    }
}
