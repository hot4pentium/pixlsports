import SwiftUI
import UIKit

/// One complete portrait front shared by the dashboard and HYPE Card screen.
struct NativeHypeCardFront: View {
    let athleteName: String
    let teamName: String
    let seasonName: String
    let photoURL: URL?
    let privatePhoto: UIImage?
    var identityDetails: String = ""

    static func publicPhotoURL(_ value: String?) -> URL? {
        guard let value, let origin = try? NativeAccountLinkClient.apiOrigin(),
              origin.scheme?.lowercased() == "https",
              let url = URL(string: value, relativeTo: origin)?.absoluteURL,
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == origin.host?.lowercased(),
              url.user == nil, url.password == nil,
              url.port == origin.port else { return nil }
        return url
    }

    var body: some View {
        GeometryReader { geometry in
            let scale = geometry.size.width / 320
            ZStack(alignment: .bottomLeading) {
                LinearGradient(
                    colors: [SupporterHomeColors.blue.opacity(0.9), SupporterHomeColors.panel, SupporterHomeColors.background],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                if let privatePhoto {
                    fullPhoto(Image(uiImage: privatePhoto), size: geometry.size)
                } else if let photoURL {
                    AsyncImage(url: photoURL) { phase in
                        if let image = phase.image {
                            fullPhoto(image, size: geometry.size)
                        } else {
                            silhouette
                                .overlay(alignment: .topTrailing) {
                                    if phase.error != nil {
                                        Image(systemName: "exclamationmark.triangle.fill")
                                            .foregroundStyle(SupporterHomeColors.accent)
                                            .padding(10 * scale)
                                    }
                                }
                        }
                    }
                } else {
                    silhouette
                }
                LinearGradient(
                    colors: [.clear, .black.opacity(0.05), .black.opacity(0.82)],
                    startPoint: .center, endPoint: .bottom
                )
                VStack(alignment: .leading, spacing: 4 * scale) {
                    Text("PIXL SPORTS · HYPE CARD")
                        .font(.system(size: max(6, 10 * scale), weight: .black))
                        .tracking(1.6 * scale)
                        .foregroundStyle(SupporterHomeColors.accent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text(athleteName)
                        .font(.system(size: max(12, 34 * scale), weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.65)
                    Text([teamName, seasonName].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.system(size: max(8, 14 * scale), weight: .bold))
                        .foregroundStyle(.white.opacity(0.88))
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                    if !identityDetails.isEmpty {
                        Text(identityDetails)
                            .font(.system(size: max(7, 11 * scale), weight: .semibold))
                            .foregroundStyle(.white.opacity(0.88))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                .padding(20 * scale)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .aspectRatio(2.0 / 3.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 19, style: .continuous)
                .strokeBorder(SupporterHomeColors.blue.opacity(0.85), lineWidth: 1.5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(athleteName), \(teamName), \(seasonName), HYPE Card")
    }

    private func fullPhoto(_ image: Image, size: CGSize) -> some View {
        image.resizable()
            .scaledToFit()
            .frame(width: size.width, height: size.height)
    }

    private var silhouette: some View {
        Image(systemName: "person.fill")
            .resizable()
            .scaledToFit()
            .foregroundStyle(.white.opacity(0.18))
            .padding(28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityHidden(true)
    }
}
