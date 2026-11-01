import SwiftUI
import PhotosUI
import UIKit
import ClerkKit

struct NativeAthletePhotoState: Decodable {
    let cardId: String
    let athleteName: String
    let hasPhoto: Bool
    let revision: String
}

private struct NativeAthletePhotoExpectation: Encodable {
    let cardId: String
    let revision: String
}

extension SupporterHomeAPI {
    @MainActor
    static func fetchAthletePhotoState(clerk: Clerk) async throws -> NativeAthletePhotoState {
        let data = try await NativeAccountLinkClient().getData("supporter/hype-card/athlete-photo", clerk: clerk)
        return try JSONDecoder().decode(NativeAthletePhotoState.self, from: data)
    }

    @MainActor
    static func fetchAthletePhoto(expected: NativeAthletePhotoState, clerk: Clerk) async throws -> Data {
        try await NativeAccountLinkClient().getData(
            "supporter/hype-card/athlete-photo/image",
            headers: ["X-Hype-Card-ID": expected.cardId, "X-Photo-Revision": expected.revision],
            clerk: clerk
        )
    }

    @MainActor
    static func saveAthletePhoto(
        _ contents: Data, expected: NativeAthletePhotoState, clerk: Clerk
    ) async throws -> NativeAthletePhotoState {
        let data = try await NativeAccountLinkClient().uploadAthletePhoto(
            contents, cardID: expected.cardId, revision: expected.revision, clerk: clerk
        )
        return try JSONDecoder().decode(NativeAthletePhotoState.self, from: data)
    }

    @MainActor
    static func removeAthletePhoto(
        expected: NativeAthletePhotoState, clerk: Clerk
    ) async throws -> NativeAthletePhotoState {
        let data = try await NativeAccountLinkClient().postData(
            "supporter/hype-card/athlete-photo",
            body: NativeAthletePhotoExpectation(cardId: expected.cardId, revision: expected.revision),
            method: "DELETE", clerk: clerk
        )
        return try JSONDecoder().decode(NativeAthletePhotoState.self, from: data)
    }
}

struct NativeAthletePhotoSection: View {
    let clerk: Clerk
    let profileIsSaved: Bool
    @State private var photoState: NativeAthletePhotoState?
    @State private var photo: UIImage?
    @State private var selection: PhotosPickerItem?
    @State private var isLoading = true
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var successMessage: String?
    @State private var confirmingRemoval = false

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 14) {
                if isLoading {
                    ProgressView("Loading athlete photo")
                        .tint(.white)
                        .accessibilityIdentifier("native-athlete-photo-loading")
                } else {
                    if let photo {
                        Image(uiImage: photo)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: 200)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .accessibilityLabel("\(photoState?.athleteName ?? "Athlete") photo")
                            .accessibilityIdentifier("native-athlete-photo-preview")
                    } else {
                        Label(photoState?.hasPhoto == true ? "Photo preview unavailable" : "Add your athlete’s photo",
                              systemImage: "person.crop.rectangle")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 90)
                            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    }
                    if let photoState {
                        Text("HYPE Card · \(photoState.athleteName)")
                            .font(.subheadline.weight(.semibold))
                        PhotosPicker(selection: $selection, matching: .images, preferredItemEncoding: .compatible) {
                            Label(photoState.hasPhoto ? "Replace photo" : "Choose photo", systemImage: "photo.on.rectangle")
                                .font(.headline)
                                .foregroundStyle(SupporterHomeColors.background)
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 13))
                        }
                        .buttonStyle(.plain)
                        .disabled(isWorking || !profileIsSaved)
                        .accessibilityIdentifier("native-athlete-photo-choose")
                        if photoState.hasPhoto {
                            Button(role: .destructive) { confirmingRemoval = true } label: {
                                Label("Remove photo", systemImage: "trash")
                                    .foregroundStyle(Color(red: 1, green: 0.65, blue: 0.65))
                                    .frame(minHeight: 44)
                            }
                            .disabled(isWorking || !profileIsSaved)
                            .accessibilityIdentifier("native-athlete-photo-remove")
                        }
                    }
                    if isWorking {
                        ProgressView("Saving athlete photo…").tint(.white)
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundStyle(Color(red: 1, green: 0.72, blue: 0.72))
                            .accessibilityIdentifier("native-athlete-photo-error")
                        Button("Refresh photo") { Task { await loadPhoto() } }
                            .foregroundStyle(SupporterHomeColors.accent)
                            .disabled(isWorking)
                            .accessibilityIdentifier("native-athlete-photo-retry")
                    }
                    if photoState == nil {
                        NavigationLink("Review HYPE Card") { SupporterHypeCardView(clerk: clerk) }
                            .foregroundStyle(SupporterHomeColors.accent)
                    }
                    if let successMessage {
                        Text(successMessage)
                            .foregroundStyle(SupporterHomeColors.accent)
                            .accessibilityIdentifier("native-athlete-photo-success")
                    }
                    if !profileIsSaved {
                        Text("Save your athlete details before changing the photo.")
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                    Text("Used on your HYPE Card. Uploading does not publish a private card. If your card is already public, its photo will update.")
                        .font(.footnote)
                        .foregroundStyle(SupporterHomeColors.muted)
                }
            }
            .foregroundStyle(.white)
            .padding(.vertical, 6)
        } header: {
            Text("Athlete photo")
        }
        .listRowBackground(SupporterHomeColors.panel)
        .task { await loadPhoto() }
        .onChange(of: selection) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .confirmationDialog("Remove this athlete photo?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Remove photo", role: .destructive) { Task { await removePhoto() } }
        } message: {
            Text("This removes the photo from the live HYPE Card. Your other card settings stay unchanged.")
        }
    }

    @MainActor
    private func loadPhoto() async {
        guard !isWorking else { return }
        isLoading = true
        errorMessage = nil
        successMessage = nil
        photoState = nil
        photo = nil
        defer { isLoading = false }
        do {
            photoState = try await SupporterHomeAPI.fetchAthletePhotoState(clerk: clerk)
            try await loadPreview()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadPreview() async throws {
        photo = nil
        if let expected = photoState, expected.hasPhoto {
            let contents = try await SupporterHomeAPI.fetchAthletePhoto(expected: expected, clerk: clerk)
            guard let image = UIImage(data: contents) else {
                throw NativeAccountLinkError.message("The photo preview could not be displayed. Refresh to try again.")
            }
            photo = image
        }
    }

    @MainActor
    private func upload(_ item: PhotosPickerItem) async {
        guard let expected = photoState, profileIsSaved, !isWorking else { selection = nil; return }
        isWorking = true
        errorMessage = nil
        successMessage = nil
        defer { isWorking = false; selection = nil }
        do {
            guard let source = try await item.loadTransferable(type: Data.self) else {
                throw NativeAccountLinkError.message("The selected photo could not be opened.")
            }
            let prepared = await Task.detached(priority: .userInitiated) {
                NativeAthletePhotoPreparation.jpeg(source)
            }.value
            guard let contents = prepared else {
                throw NativeAccountLinkError.message("Choose a photo up to 40 MB that can be prepared for upload.")
            }
            photoState = try await SupporterHomeAPI.saveAthletePhoto(contents, expected: expected, clerk: clerk)
            successMessage = "Athlete photo saved."
            do { try await loadPreview() } catch {
                errorMessage = "Your photo was saved, but its preview couldn’t load. Refresh to try again."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func removePhoto() async {
        guard let expected = photoState, profileIsSaved, !isWorking else { return }
        isWorking = true
        errorMessage = nil
        successMessage = nil
        defer { isWorking = false }
        do {
            photoState = try await SupporterHomeAPI.removeAthletePhoto(expected: expected, clerk: clerk)
            photo = nil
            successMessage = "Athlete photo removed."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
