import Foundation
import ImageIO
import UniformTypeIdentifiers

// Kept independent of SwiftUI, UIKit, Clerk, and networking so the exact
// production preparation path can also be checked with Apple's macOS codecs.
enum NativeAthletePhotoPreparation {
    nonisolated static func jpeg(_ source: Data) -> Data? {
        guard !source.isEmpty, source.count <= 40 * 1024 * 1024,
              let imageSource = CGImageSourceCreateWithData(source as CFData, [
                kCGImageSourceShouldCache: false,
              ] as CFDictionary),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2048,
                kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary) else {
            return nil
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output, UTType.jpeg.identifier as CFString, 1, nil
        ) else { return nil }
        // Encode only the upright pixels, never source EXIF, GPS, or orientation.
        CGImageDestinationAddImage(destination, thumbnail, [
            kCGImageDestinationLossyCompressionQuality: 0.85,
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination), output.length <= 5 * 1024 * 1024 else {
            return nil
        }
        return output as Data
    }
}
