import AVKit
import Photos
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

@MainActor
struct NativeRecordMomentsView: View {
    @Environment(\.dismiss) private var dismiss

    let athleteName: String
    var eventTitle: String? = nil

    @State private var photoItem: PhotosPickerItem?
    @State private var activeSheet: ActiveSheet?
    @State private var sourceURL: URL?
    @State private var finishedURL: URL?
    @State private var sourcePlayer: AVPlayer?
    @State private var finishedPlayer: AVPlayer?
    @State private var sourceDuration = 0.0
    @State private var footageSeconds = 0.0
    @State private var trimStart = 0.0
    @State private var introSeconds = 2.0
    @State private var sourceAspectRatio: CGFloat = 9.0 / 16.0
    @State private var selectedArtwork: NativeRecordMomentArtwork = .clutch
    @State private var isImporting = false
    @State private var isExporting = false
    @State private var isSaving = false
    @State private var didSaveToPhotos = false
    @State private var errorMessage: String?

    private enum ActiveSheet: Identifiable {
        case camera
        case share(URL)

        var id: String {
            switch self {
            case .camera: return "camera"
            case let .share(url): return "share-\(url.path)"
            }
        }
    }

    private var maximumFootageSeconds: Double {
        NativeRecordMomentLimits.footageLimit(for: sourceDuration)
    }

    private var maximumTrimStart: Double {
        NativeRecordMomentLimits.maximumStart(
            sourceDuration: sourceDuration,
            footageDuration: footageSeconds
        )
    }

    private var activePlayer: AVPlayer? {
        finishedPlayer ?? sourcePlayer
    }

    private var sourceFootageBinding: Binding<Double> {
        Binding(
            get: { footageSeconds },
            set: { newValue in
                footageSeconds = newValue
                trimStart = NativeRecordMomentLimits.clampedStart(
                    trimStart, sourceDuration: sourceDuration, footageDuration: newValue
                )
                clearFinishedClip()
            }
        )
    }

    private var trimStartBinding: Binding<Double> {
        Binding(
            get: { trimStart },
            set: { newValue in
                trimStart = NativeRecordMomentLimits.clampedStart(
                    newValue, sourceDuration: sourceDuration, footageDuration: footageSeconds
                )
                clearFinishedClip()
            }
        )
    }

    var body: some View {
        ZStack {
            NativePageBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    introduction
                    videoSourceCard
                    if sourceURL != nil {
                        trimCard
                        artworkCard
                        finishedClipCard
                    }
                    privacyNote
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle("Record Moments")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { dismiss() }
                    .frame(minWidth: 44, minHeight: 44)
                    .disabled(isExporting || isSaving)
                    .accessibilityIdentifier("record-moments-done")
            }
        }
        .interactiveDismissDisabled(isExporting || isSaving)
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .camera:
                NativeRecordMomentCameraPicker(
                    onVideo: { result in
                        activeSheet = nil
                        switch result {
                        case let .success(url):
                            Task { await loadSource(url) }
                        case let .failure(error):
                            showError(error)
                        }
                    },
                    onCancel: { activeSheet = nil }
                )
                .ignoresSafeArea()
            case let .share(url):
                NativeRecordMomentShareSheet(videoURL: url)
                    .ignoresSafeArea()
            }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await loadPickedVideo(item) }
        }
        .alert("Couldn’t finish your clip", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .onDisappear {
            sourcePlayer?.pause()
            finishedPlayer?.pause()
            NativeRecordMomentFileStorage.remove(sourceURL)
            NativeRecordMomentFileStorage.remove(finishedURL)
        }
        .accessibilityIdentifier("native-record-moments-screen")
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 8) {
            SupporterEyebrow(text: "MAKE A SHAREABLE CLIP")
            Text("Celebrate \(athleteName)")
                .font(.title2.weight(.black))
                .fontDesign(.rounded)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let eventTitle, !eventTitle.isEmpty {
                Label(eventTitle, systemImage: "calendar")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Choose a shoutout intro and a short video. The intro plays first; it does not use up your 15 seconds of video.")
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("record-moments-introduction")
    }

    private var videoSourceCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            SupporterSectionHeader(eyebrow: "YOUR VIDEO", title: "Choose a clip")
            if let player = activePlayer {
                VideoPlayer(player: player)
                    .aspectRatio(sourceAspectRatio, contentMode: .fit)
                    .frame(maxHeight: 360)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityLabel(finishedURL == nil ? "Selected video preview" : "Finished clip preview")
                    .accessibilityIdentifier("record-moments-video-preview")

                Text(finishedURL == nil ? "Selected video · \(formattedDuration(sourceDuration))" : "Your finished clip")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Label("Pick a video from Photos, or record one on your iPhone.", systemImage: "video")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 8)
            }

            PhotosPicker(
                selection: $photoItem,
                matching: .videos,
                preferredItemEncoding: .current
            ) {
                Label(isImporting ? "Opening video…" : "Choose a video", systemImage: "photo.on.rectangle.angled")
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(SupporterHomeColors.accent)
            .foregroundStyle(SupporterHomeColors.background)
            .disabled(isImporting || isExporting)
            .accessibilityIdentifier("record-moments-choose-video")

            if NativeRecordMomentCameraPicker.isAvailable {
                Button {
                    activeSheet = .camera
                } label: {
                    Label("Record with Camera", systemImage: "video.badge.plus")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.bordered)
                .tint(.white)
                .disabled(isImporting || isExporting)
                .accessibilityIdentifier("record-moments-record-video")
            } else {
                Text("Camera recording is available on iPhone. In the simulator, choose a video from Photos.")
                    .font(.footnote)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("record-moments-camera-unavailable")
            }

            if isImporting {
                ProgressView("Opening video…")
                    .tint(SupporterHomeColors.accent)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
        }
        .padding(16)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(SupporterHomeColors.blue.opacity(0.28), lineWidth: 1)
        }
    }

    private var trimCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            SupporterSectionHeader(eyebrow: "VIDEO LENGTH", title: "Pick the moment")
            Text("Use up to 15 seconds of your video. The selected shoutout intro is added before it.")
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)

            if maximumFootageSeconds >= NativeRecordMomentLimits.minimumFootageSeconds + 0.1 {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Video")
                        Spacer()
                        Text("\(formattedDuration(footageSeconds)) of \(formattedDuration(sourceDuration))")
                            .monospacedDigit()
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                    .font(.subheadline.weight(.semibold))
                    Slider(
                        value: sourceFootageBinding,
                        in: NativeRecordMomentLimits.minimumFootageSeconds...maximumFootageSeconds,
                        step: 0.1
                    )
                    .tint(SupporterHomeColors.accent)
                    .accessibilityLabel("Video length")
                    .accessibilityValue("\(formattedDuration(footageSeconds)) seconds")
                    .accessibilityIdentifier("record-moments-duration-slider")
                }

                if maximumTrimStart >= 0.1 {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Start")
                            Spacer()
                            Text("\(formattedDuration(trimStart)) – \(formattedDuration(trimStart + footageSeconds))")
                                .monospacedDigit()
                                .foregroundStyle(SupporterHomeColors.muted)
                        }
                        .font(.subheadline.weight(.semibold))
                        Slider(value: trimStartBinding, in: 0...maximumTrimStart)
                            .tint(SupporterHomeColors.accent)
                            .accessibilityLabel("Start position in video")
                            .accessibilityValue("\(formattedDuration(trimStart))")
                            .accessibilityIdentifier("record-moments-start-slider")
                    }
                } else {
                    Text("Using the full video.")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(SupporterHomeColors.muted)
                }
            } else {
                Text(sourceDuration >= NativeRecordMomentLimits.minimumFootageSeconds
                     ? "Using the full available video."
                     : "Choose a video that is at least half a second long.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.orange)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Shoutout intro")
                    Spacer()
                    Text("\(introSeconds, specifier: "%.1f") sec")
                        .monospacedDigit()
                        .foregroundStyle(SupporterHomeColors.muted)
                }
                .font(.subheadline.weight(.semibold))
                Slider(value: $introSeconds, in: NativeRecordMomentExporter.introDurationRange, step: 0.5)
                    .tint(SupporterHomeColors.accent)
                    .accessibilityLabel("Shoutout intro length")
                    .accessibilityValue("\(introSeconds, specifier: "%.1f") seconds")
                    .onChange(of: introSeconds) { _, _ in clearFinishedClip() }
            }
        }
        .padding(16)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("record-moments-trim-controls")
    }

    private var artworkCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            SupporterSectionHeader(eyebrow: "BEFORE YOUR VIDEO", title: "Choose a shoutout")
            Text("Your graphic appears as a short lead-in.")
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(NativeRecordMomentArtwork.allCases) { artwork in
                    Button {
                        selectedArtwork = artwork
                        clearFinishedClip()
                    } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            Image(artwork.assetName)
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: .infinity)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    if selectedArtwork == artwork {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.title3)
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, SupporterHomeColors.accent)
                                            .padding(7)
                                            .accessibilityHidden(true)
                                    }
                                }
                            Text(artwork.title)
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(.white)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SupporterHomeColors.background, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 15, style: .continuous)
                                .strokeBorder(
                                    selectedArtwork == artwork ? SupporterHomeColors.accent : .white.opacity(0.12),
                                    lineWidth: selectedArtwork == artwork ? 2 : 1
                                )
                        }
                        .contentShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(artwork.title) shoutout graphic")
                    .accessibilityValue(selectedArtwork == artwork ? "Selected" : "Not selected")
                    .accessibilityIdentifier("record-moments-artwork-\(artwork.rawValue)")
                }
            }
        }
        .padding(16)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("record-moments-artwork-choices")
    }

    private var finishedClipCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            SupporterSectionHeader(eyebrow: "READY TO SHARE", title: "Your clip")

            if let finishedURL {
                Label("Clip ready", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .accessibilityIdentifier("record-moments-export-ready")

                Button {
                    shareClip(finishedURL)
                } label: {
                    Label("Share clip", systemImage: "square.and.arrow.up")
                        .font(.headline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
                .tint(.white)
                .accessibilityIdentifier("record-moments-share")

                Button {
                    Task { await saveClip(finishedURL) }
                } label: {
                    Label(isSaving ? "Saving…" : didSaveToPhotos ? "Saved to Photos" : "Save to Photos",
                          systemImage: didSaveToPhotos ? "checkmark" : "square.and.arrow.down")
                        .font(.headline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(SupporterHomeColors.accent)
                .foregroundStyle(SupporterHomeColors.background)
                .disabled(isSaving || didSaveToPhotos)
                .accessibilityIdentifier("record-moments-save-to-photos")
            } else {
                Button {
                    Task { await createFinishedClip() }
                } label: {
                    HStack(spacing: 10) {
                        if isExporting {
                            ProgressView().tint(SupporterHomeColors.background)
                        } else {
                            Image(systemName: "sparkles")
                        }
                        Text(isExporting ? "Making your clip…" : "Create my clip")
                    }
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .tint(SupporterHomeColors.accent)
                .foregroundStyle(SupporterHomeColors.background)
                .disabled(
                    isExporting || isImporting
                    || sourceURL == nil
                    || footageSeconds < NativeRecordMomentLimits.minimumFootageSeconds
                )
                .accessibilityIdentifier("record-moments-create")

                if isExporting {
                    Text("Preparing this on your iPhone. Your original video stays unchanged.")
                        .font(.footnote)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if didSaveToPhotos {
                Text("Saved in Photos. You can share it later from there.")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("record-moments-saved-message")
            }
        }
        .padding(16)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("record-moments-finish")
    }

    private var privacyNote: some View {
        Label(
            "Your video stays on this iPhone unless you choose Save to Photos or Share.",
            systemImage: "iphone"
        )
        .font(.footnote.weight(.medium))
        .foregroundStyle(SupporterHomeColors.muted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 4)
        .accessibilityIdentifier("record-moments-privacy")
    }

    private func loadPickedVideo(_ item: PhotosPickerItem) async {
        isImporting = true
        defer {
            isImporting = false
            photoItem = nil
        }
        do {
            guard let transferred = try await item.loadTransferable(type: NativeRecordMomentTransferFile.self) else {
                throw NativeRecordMomentMediaError.cannotReadVideo
            }
            await loadSource(transferred.url)
        } catch {
            showError(error)
        }
    }

    private func loadSource(_ url: URL) async {
        do {
            let asset = AVURLAsset(url: url)
            let duration = CMTimeGetSeconds(try await asset.load(.duration))
            guard duration.isFinite, duration >= NativeRecordMomentLimits.minimumFootageSeconds,
                  let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
                NativeRecordMomentFileStorage.remove(url)
                throw NativeRecordMomentMediaError.videoTooShort
            }
            let naturalSize = try await videoTrack.load(.naturalSize)
            let transform = try await videoTrack.load(.preferredTransform)
            let bounds = CGRect(origin: .zero, size: naturalSize).applying(transform).standardized
            guard bounds.width > 0, bounds.height > 0 else {
                NativeRecordMomentFileStorage.remove(url)
                throw NativeRecordMomentMediaError.cannotReadVideo
            }

            if sourceURL != url {
                NativeRecordMomentFileStorage.remove(sourceURL)
            }
            clearFinishedClip()
            sourceURL = url
            sourceDuration = duration
            footageSeconds = NativeRecordMomentLimits.footageLimit(for: duration)
            trimStart = 0
            sourceAspectRatio = bounds.width / bounds.height
            sourcePlayer = AVPlayer(url: url)
            didSaveToPhotos = false
            selectedArtwork = .clutch
        } catch {
            NativeRecordMomentFileStorage.remove(url)
            showError(error)
        }
    }

    private func createFinishedClip() async {
        guard let sourceURL else { return }
        isExporting = true
        errorMessage = nil
        defer { isExporting = false }

        do {
            let result = try await NativeRecordMomentExporter.export(
                sourceURL: sourceURL,
                startSeconds: trimStart,
                footageSeconds: footageSeconds,
                introSeconds: introSeconds,
                artwork: selectedArtwork
            )
            finishedURL = result.url
            sourceAspectRatio = result.aspectRatio
            finishedPlayer = AVPlayer(url: result.url)
            finishedPlayer?.play()
            didSaveToPhotos = false
        } catch {
            showError(error)
        }
    }

    private func saveClip(_ url: URL) async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            try await NativeRecordMomentPhotoSaver.saveVideo(at: url)
            didSaveToPhotos = true
        } catch {
            showError(error)
        }
    }

    private func shareClip(_ url: URL) {
        activeSheet = .share(url)
    }

    private func clearFinishedClip() {
        finishedPlayer?.pause()
        finishedPlayer = nil
        NativeRecordMomentFileStorage.remove(finishedURL)
        finishedURL = nil
        didSaveToPhotos = false
    }

    private func showError(_ error: Error) {
        errorMessage = (error as? LocalizedError)?.errorDescription
            ?? "Something went wrong. Try another video."
    }

    private func formattedDuration(_ seconds: Double) -> String {
        let wholeSeconds = max(0, Int(seconds.rounded(.down)))
        return String(format: "%d:%02d", wholeSeconds / 60, wholeSeconds % 60)
    }
}
