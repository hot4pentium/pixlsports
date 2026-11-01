import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Run on macOS with Apple's Swift compiler. No app, account, network, or
// personal Photos library is needed. Fixtures are generated in memory.
@main
struct NativeAthletePhotoPreparationChecks {
    static let colors: [[UInt8]] = [
        [230, 25, 25, 255], [25, 210, 25, 255],
        [25, 25, 230, 255], [230, 210, 25, 255],
    ]

    static func fixture(width: Int = 96, height: Int = 64) -> CGImage {
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let color = colors[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]
                let offset = (y * width + x) * 4
                for channel in 0..<4 { pixels[offset + channel] = color[channel] }
            }
        }
        let provider = CGDataProvider(data: Data(pixels) as CFData)!
        return CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
                .union(.byteOrder32Big),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
        )!
    }

    static func encode(_ image: CGImage, type: UTType = .jpeg, orientation: Int = 1) -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data, type.identifier as CFString, 1, nil
        ) else { fatalError("Apple \(type.identifier) encoder unavailable; this case is NOT verified.") }
        CGImageDestinationAddImage(destination, image, [
            kCGImageDestinationLossyCompressionQuality: 0.95,
            kCGImagePropertyOrientation: orientation,
            kCGImagePropertyExifDictionary: [kCGImagePropertyExifUserComment: "private fixture"],
            kCGImagePropertyGPSDictionary: [
                kCGImagePropertyGPSLatitude: 1.0, kCGImagePropertyGPSLatitudeRef: "N",
            ],
        ] as CFDictionary)
        precondition(CGImageDestinationFinalize(destination), "Fixture encoding must succeed, not skip.")
        return data as Data
    }

    static func prepared(_ input: Data) -> (CGImage, [CFString: Any]) {
        guard let output = NativeAthletePhotoPreparation.jpeg(input),
              let source = CGImageSourceCreateWithData(output as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { fatalError("Valid source must produce a decodable JPEG.") }
        precondition(CGImageSourceGetType(source) as String? == UTType.jpeg.identifier)
        precondition(output.count <= 5 * 1024 * 1024)
        precondition(max(image.width, image.height) <= 2048)
        precondition((properties[kCGImagePropertyOrientation] as? Int ?? 1) == 1)
        precondition(properties[kCGImagePropertyGPSDictionary] == nil, "No source GPS may survive.")
        let exif = properties[kCGImagePropertyExifDictionary] as? [CFString: Any]
        precondition(exif?[kCGImagePropertyExifUserComment] == nil, "No source comment may survive.")
        return (image, properties)
    }

    static func assertCorners(_ image: CGImage, _ expected: [Int]) {
        let width = image.width
        let height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        pixels.withUnsafeMutableBytes { bytes in
            let context = CGContext(
                data: bytes.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue
            )!
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        for (index, point) in [
            (width / 4, height / 4), (3 * width / 4, height / 4),
            (width / 4, 3 * height / 4), (3 * width / 4, 3 * height / 4),
        ].enumerated() {
            let offset = (point.1 * width + point.0) * 4
            for channel in 0..<3 {
                precondition(
                    abs(Int(pixels[offset + channel]) - Int(colors[expected[index]][channel])) < 45,
                    "Upright pixels must match the EXIF transform, not just its dimensions."
                )
            }
        }
    }

    static func main() {
        let image = fixture()
        // EXIF 1–8, including mirrored and axis-swapping orientations.
        let corners = [
            [0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1],
            [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2],
        ]
        for orientation in 1...8 {
            let source = encode(image, orientation: orientation)
            let sourceProperties = CGImageSourceCopyPropertiesAtIndex(
                CGImageSourceCreateWithData(source as CFData, nil)!, 0, nil
            ) as! [CFString: Any]
            precondition(sourceProperties[kCGImagePropertyOrientation] as? Int == orientation)
            let (output, _) = prepared(source)
            precondition(output.width == (orientation >= 5 ? 64 : 96))
            precondition(output.height == (orientation >= 5 ? 96 : 64))
            assertCorners(output, corners[orientation - 1])
        }
        print("PASS: JPEG EXIF orientations 1–8 and metadata removal")

        let heic = encode(image, type: .heic, orientation: 6)
        let (converted, _) = prepared(heic)
        precondition(converted.width == 64 && converted.height == 96)
        assertCorners(converted, corners[5])
        print("PASS: rotated HEIC becomes upright JPEG")

        autoreleasepool {
            let large = encode(fixture(width: 4096, height: 3072), orientation: 6)
            let (output, _) = prepared(large)
            precondition(output.width == 1536 && output.height == 2048)
            assertCorners(output, corners[5])
        }
        print("PASS: large rotated source is downsampled to 2048 pixels")

        for bad in [Data(), Data("unreadable image".utf8), Data(encode(image).prefix(16))] {
            precondition(NativeAthletePhotoPreparation.jpeg(bad) == nil)
        }
        var oversized = encode(image)
        oversized.append(Data(count: 40 * 1024 * 1024 + 1 - oversized.count))
        precondition(NativeAthletePhotoPreparation.jpeg(oversized) == nil)
        print("PASS: empty, unreadable, truncated, and over-40-MB input rejected")
    }
}
