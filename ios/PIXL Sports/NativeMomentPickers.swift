import SwiftUI
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers

private enum NativeMomentSourceSize {
    static func validate(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        guard let size = values.fileSize, size > 0 else {
            throw NativeMomentError.message("The video file is empty or could not be read.")
        }
        guard size <= 120 * 1024 * 1024 else {
            throw NativeMomentError.message("Choose a video no larger than 120 MB.")
        }
    }
}

/// File representations are copied in the provider callback, before its URL expires.
struct NativeMomentLibraryPicker: UIViewControllerRepresentable {
    let directory: URL
    let loading: () -> Void
    let progress: (Progress) -> Void
    let completion: (Result<URL?, Error>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .videos
        config.selectionLimit = 1
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let parent: NativeMomentLibraryPicker
        init(_ parent: NativeMomentLibraryPicker) { self.parent = parent }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider else {
                parent.completion(.success(nil)); return
            }
            parent.loading()
            let directory = parent.directory
            let completion = parent.completion
            let progress = provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, error in
                let result: Result<URL?, Error>
                var partialCopy: URL?
                do {
                    if let error { throw error }
                    guard let url else { throw NativeMomentError.message("The video is unavailable. If it is in iCloud, connect and download it first.") }
                    try NativeMomentSourceSize.validate(url)
                    let target = directory.appendingPathComponent("source-\(UUID())")
                        .appendingPathExtension(url.pathExtension.isEmpty ? "mov" : url.pathExtension)
                    partialCopy = target
                    try FileManager.default.copyItem(at: url, to: target)
                    partialCopy = nil
                    result = .success(target)
                } catch {
                    if let partialCopy { try? FileManager.default.removeItem(at: partialCopy) }
                    result = .failure(error)
                }
                DispatchQueue.main.async { completion(result) }
            }
            parent.progress(progress)
        }
    }
}

struct NativeMomentCameraPicker: UIViewControllerRepresentable {
    let directory: URL
    let completion: (Result<URL?, Error>) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.movie.identifier]
        picker.cameraCaptureMode = .video
        picker.videoQuality = .typeHigh
        picker.videoExportPreset = AVAssetExportPresetPassthrough
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: NativeMomentCameraPicker
        init(_ parent: NativeMomentCameraPicker) { self.parent = parent }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.completion(.success(nil)) }
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            var partialCopy: URL?
            do {
                guard let url = info[.mediaURL] as? URL else { throw NativeMomentError.message("The camera did not return a video.") }
                try NativeMomentSourceSize.validate(url)
                let target = parent.directory.appendingPathComponent("source-\(UUID()).mov")
                partialCopy = target
                try FileManager.default.copyItem(at: url, to: target)
                partialCopy = nil
                // Camera's disposable capture is separate from the user's Photos library.
                try? FileManager.default.removeItem(at: url)
                parent.completion(.success(target))
            } catch {
                if let partialCopy { try? FileManager.default.removeItem(at: partialCopy) }
                parent.completion(.failure(error))
            }
        }
    }
}

struct NativeMomentShareSheet: UIViewControllerRepresentable {
    let url: URL
    let completion: (Bool, Error?) -> Void
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, error in
            DispatchQueue.main.async { completion(completed, error) }
        }
        return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
