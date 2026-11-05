import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct NativeRecordMomentsLaunchCard: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: "video.badge.plus")
                .font(.title3.weight(.bold))
                .foregroundStyle(SupporterHomeColors.background)
                .frame(width: 46, height: 46)
                .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                SupporterEyebrow(text: "GAME-DAY MOMENT")
                Text(title)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Image(systemName: "arrow.right")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(SupporterHomeColors.accent)
                .padding(.top, 4)
                .accessibilityHidden(true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(SupporterHomeColors.accent.opacity(0.28), lineWidth: 1)
        }
        .supporterSurfaceShadow()
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

@MainActor
struct NativeRecordMomentCameraPicker: UIViewControllerRepresentable {
    let onVideo: (Result<URL, Error>) -> Void
    let onCancel: () -> Void

    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.movie.identifier]
        picker.cameraCaptureMode = .video
        picker.videoQuality = .typeHigh
        picker.videoMaximumDuration = 600
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onVideo: onVideo, onCancel: onCancel)
    }

    @MainActor
    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        private let onVideo: (Result<URL, Error>) -> Void
        private let onCancel: () -> Void

        init(onVideo: @escaping (Result<URL, Error>) -> Void, onCancel: @escaping () -> Void) {
            self.onVideo = onVideo
            self.onCancel = onCancel
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            guard let sourceURL = info[.mediaURL] as? URL else {
                onVideo(.failure(NativeRecordMomentMediaError.cannotReadVideo))
                return
            }
            do {
                onVideo(.success(try NativeRecordMomentFileStorage.importFile(at: sourceURL)))
            } catch {
                onVideo(.failure(error))
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onCancel()
        }
    }
}

private struct NativeRecordMomentShareActivity: UIViewControllerRepresentable {
    let videoURL: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [videoURL], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct NativeRecordMomentShareSheet: View {
    let videoURL: URL

    var body: some View {
        NativeRecordMomentShareActivity(videoURL: videoURL)
            .ignoresSafeArea()
    }
}
