import CoreGraphics
import Foundation

/// A resolution-independent sports rim. The opening keeps the source aspect ratio.
enum NativeMomentArenaFrame {
    static func renderSize(for oriented: CGSize) -> CGSize {
        let scale = min(1, 1080 / max(oriented.width, oriented.height))
        return CGSize(width: max(2, floor(oriented.width * scale / 2) * 2),
                      height: max(2, floor(oriented.height * scale / 2) * 2))
    }

    static func footageRect(in size: CGSize) -> CGRect {
        CGRect(x: size.width * 0.035, y: size.height * 0.035,
               width: size.width * 0.93, height: size.height * 0.93)
    }

    static func image(size: CGSize) throws -> CGImage {
        guard size.width >= 2, size.height >= 2,
              let context = CGContext(data: nil, width: Int(size.width), height: Int(size.height),
                                      bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw NativeMomentError.message("The video frame could not be prepared.")
        }
        let bounds = CGRect(origin: .zero, size: size)
        let opening = footageRect(in: size)
        let unit = min(size.width, size.height)
        let navy = CGColor(red: 0.025, green: 0.055, blue: 0.12, alpha: 1)
        let blue = CGColor(red: 0.07, green: 0.39, blue: 1, alpha: 1)
        let cyan = CGColor(red: 0.18, green: 0.77, blue: 1, alpha: 1)
        let lime = CGColor(red: 0.72, green: 0.96, blue: 0.16, alpha: 1)
        context.setFillColor(navy)
        context.fill(bounds)
        context.clear(opening)

        // Keep every decorative mark outside the video opening.
        context.saveGState()
        let rim = CGMutablePath()
        rim.addRect(bounds)
        rim.addRect(opening)
        context.addPath(rim)
        context.clip(using: .evenOdd)
        if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                     colors: [blue, navy, navy, cyan] as CFArray,
                                     locations: [0, 0.28, 0.72, 1]) {
            context.drawLinearGradient(gradient, start: .zero,
                                       end: CGPoint(x: size.width, y: size.height), options: [])
        }
        // Angular corner panels and short speed stripes.
        let corner = unit * 0.09
        for (x, y, dx, dy, color) in [
            (CGFloat(0), CGFloat(0), CGFloat(1), CGFloat(1), blue),
            (size.width, size.height, CGFloat(-1), CGFloat(-1), lime),
            (CGFloat(0), size.height, CGFloat(1), CGFloat(-1), cyan),
            (size.width, CGFloat(0), CGFloat(-1), CGFloat(1), blue)
        ] {
            context.setFillColor(color)
            context.beginPath()
            context.move(to: CGPoint(x: x, y: y))
            context.addLine(to: CGPoint(x: x + dx * corner * 1.7, y: y))
            context.addLine(to: CGPoint(x: x, y: y + dy * corner))
            context.closePath()
            context.fillPath()
        }
        context.setStrokeColor(lime)
        context.setLineWidth(max(1, unit * 0.008))
        for index in 0..<3 {
            let x = size.width * 0.67 + CGFloat(index) * unit * 0.025
            context.move(to: CGPoint(x: x, y: size.height * 0.986))
            context.addLine(to: CGPoint(x: x + unit * 0.018, y: size.height * 0.963))
        }
        context.strokePath()
        context.restoreGState()
        context.setStrokeColor(cyan.copy(alpha: 0.8) ?? cyan)
        context.setLineWidth(max(0.6, unit * 0.002))
        context.stroke(opening.insetBy(dx: -unit * 0.001, dy: -unit * 0.001))
        context.setStrokeColor(CGColor(gray: 0.85, alpha: 0.45))
        context.setLineWidth(max(0.5, unit * 0.0015))
        context.stroke(bounds.insetBy(dx: unit * 0.004, dy: unit * 0.004))
        guard let image = context.makeImage() else {
            throw NativeMomentError.message("The video frame could not be prepared.")
        }
        return image
    }
}
