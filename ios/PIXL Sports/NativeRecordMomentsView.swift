import SwiftUI
import AVKit

/// A device-only editor. Event context is an optional label, never an export requirement.
struct NativeRecordMomentsView: View {
    var athleteName: String = "your athlete"
    var eventTitle: String? = nil
    @StateObject private var model = NativeMomentModel()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var presented: Presentation?
    @State private var showingCamera = false
    @State private var authorizing = false
    private enum Presentation: String, Identifiable {
        case library, share
        var id: String { rawValue }
    }

    var body: some View {
        Form {
            Section {
                Text("Celebrate \(athleteName)").font(.headline)
                Text("Create a clip with a shoutout intro. Your video stays on this iPhone unless you choose to share it.")
                if let eventTitle { Text(eventTitle).font(.subheadline).foregroundStyle(.secondary) }
            }
            Section("1 · Choose your video") {
                Button {
                    if model.preparePicker() { presented = .library }
                } label: { Label("Choose video", systemImage: "photo.on.rectangle") }
                .accessibilityIdentifier("record-moments-choose")
                Button { Task { await record() } } label: {
                    Label("Record video", systemImage: "video.fill")
                }
                .accessibilityIdentifier("record-moments-camera")
            }
            .disabled(model.busy || authorizing)

            if model.source != nil {
                let previewStep = model.shoutout?.videoResource == nil ? 4 : 5
                trimSection
                    .disabled(model.busy)
                shoutoutSection
                    .disabled(model.busy)
                if model.shoutout?.videoResource != nil {
                    introMusicSection
                        .disabled(model.busy)
                }
                Section(model.output == nil
                        ? "\(previewStep) · Selected footage preview"
                        : "\(previewStep) · Finished MP4 preview") {
                    if let player = model.player {
                        VideoPlayer(player: player)
                            // A replacement player must not retain the prior preview's rendered view.
                            .id(model.previewID)
                            .frame(height: 280)
                            .accessibilityIdentifier("record-moments-preview")
                    }
                    Text(model.output == nil
                         ? "Preview shows your selected footage. Create the clip to preview the intro, music cue, and footage together."
                         : "Check the intro, action, and original sound before saving or sharing.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button(model.output == nil ? "Create clip & preview" : "Recreate clip & preview", action: model.export)
                        .accessibilityIdentifier("record-moments-export")
                        .disabled(model.busy || model.plan == nil)
                }
                if model.output != nil {
                    Section("\(previewStep + 1) · Keep or share") {
                        Button(action: model.save) { Label("Save to Photos", systemImage: "square.and.arrow.down") }
                            .accessibilityIdentifier("record-moments-save")
                        Button {
                            model.stopPlayback()
                            presented = .share
                        } label: { Label("Share finished clip", systemImage: "square.and.arrow.up") }
                        .accessibilityIdentifier("record-moments-share")
                        Text("Saving and sharing never publishes a HYPE Card or uploads a clip to PIXL Sports.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .disabled(model.busy)
                }
            }
            if model.busy || authorizing {
                Section {
                    ProgressView(model.message ?? "Preparing…")
                    if model.isExporting {
                        Button("Cancel export", role: .cancel, action: model.cancelExport)
                    }
                    if model.isImporting {
                        Button("Cancel import", role: .cancel, action: model.cancelImport)
                    }
                }
            } else if let message = model.message {
                Section { Text(message).accessibilityIdentifier("record-moments-status") }
            }
        }
        .foregroundStyle(SupporterHomeColors.background)
        .tint(SupporterHomeColors.blue)
        .navigationTitle("Record Moments")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    dismiss()
                } label: {
                    Text("Done")
                        .foregroundStyle(SupporterHomeColors.background)
                }
                .disabled(model.busy || authorizing)
            }
        }
        .interactiveDismissDisabled(model.busy || authorizing)
        .sheet(item: $presented) { presentation in
            switch presentation {
            case .library:
                let id = model.pickerID
                NativeMomentLibraryPicker(directory: model.directory, loading: {
                    presented = nil
                    model.importing(id: id)
                }, progress: { model.trackImport($0, id: id) }, completion: {
                    model.receive($0, id: id)
                })
                .ignoresSafeArea()
            case .share:
                if let output = model.output {
                    NativeMomentShareSheet(url: output) { completed, error in
                        if let error { model.error = "Couldn’t share this clip. \(error.localizedDescription)" }
                        else { model.message = completed ? "Share completed." : "Sharing cancelled. Your finished clip is still available." }
                        // Leave dismissal to UIKit; keep the file until the share sheet finishes.
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            let id = model.pickerID
            NativeMomentCameraPicker(directory: model.directory) {
                showingCamera = false
                model.receive($0, id: id)
            }
            .ignoresSafeArea()
            .interactiveDismissDisabled()
        }
        .alert("Record Moments", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) { model.error = nil }
            if model.permissionDenied {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
        } message: { Text(model.error ?? "") }
        .onChange(of: model.start) { _, _ in model.selectionChanged() }
        .onChange(of: model.footage) { _, _ in model.selectionChanged() }
        .onChange(of: model.shoutout) { _, _ in model.selectionChanged() }
        .onChange(of: model.introSeconds) { _, _ in model.selectionChanged() }
        .onChange(of: model.introMusicEnabled) { _, _ in model.introMusicSelectionChanged() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { model.stopPlayback() } }
        .onDisappear {
            // Full-screen capture hides the editor; it has not ended the edit session.
            if !showingCamera, presented == nil { model.shutdown() }
        }
        .accessibilityIdentifier("native-record-moments-screen")
    }

    private var trimSection: some View {
        Section("2 · Select up to 15 seconds of footage") {
            Text(String(format: "Start %.2fs · Footage %.2fs · Finished %.2fs",
                        model.start, model.footage, model.footage + (model.plan?.intro ?? model.introSeconds)))
                .monospacedDigit()
            NativeMomentTrimTimeline(model: model)
                .frame(height: 92)
                .accessibilityIdentifier("record-moments-trim-timeline")
            if model.isGeneratingThumbnails {
                Text("Preparing a private thumbnail timeline on this iPhone…")
                    .font(.caption).foregroundStyle(.secondary)
            } else if model.thumbnails.allSatisfy({ $0 == nil }) {
                Text("Thumbnail previews aren’t available. You can still trim with the sliders.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("Drag the blue start and orange end handles to choose the action.")
                .font(.caption).foregroundStyle(.secondary)
            if model.maximumStart > model.minimumStart {
                Slider(value: Binding(
                    get: { model.start },
                    set: { model.setTrimStart($0) }
                ), in: model.minimumStart...model.maximumStart)
                    .accessibilityLabel("Footage start")
                    .accessibilityValue(String(format: "%.2f seconds", model.start))
                    .accessibilityIdentifier("record-moments-start")
            }
            if model.maximumFootage > 0.1 {
                Slider(value: $model.footage, in: min(0.1, model.maximumFootage)...model.maximumFootage)
                    .accessibilityLabel("Footage duration")
                    .accessibilityValue(String(format: "%.2f seconds", model.footage))
                    .accessibilityIdentifier("record-moments-duration")
            }
            Text("The shoutout intro is additional. It never reduces your 15-second footage allowance.")
                .font(.caption).foregroundStyle(.secondary)
            if !model.hasAudio {
                Label("This source video has no audio.", systemImage: "speaker.slash")
                    .font(.caption)
            }
        }
    }

    private var shoutoutSection: some View {
        Section("3 · Choose a shoutout intro") {
            Text(model.shoutout.map { "Selected for this clip: \($0.title)" }
                 ?? "Choose an intro for this video. Previous choices won’t carry over.")
                .font(.subheadline)
            if let fixedIntroSeconds = model.shoutout?.fixedIntroSeconds {
                Text(String(format: "Animated video intro · %.1f seconds", fixedIntroSeconds))
            } else {
                Text(String(format: "Shoutout intro · %.1f seconds", model.introSeconds))
                Slider(value: $model.introSeconds, in: NativeMomentPlan.introRange, step: 0.5)
                    .accessibilityLabel("Shoutout intro length")
                    .accessibilityValue(String(format: "%.1f seconds", model.introSeconds))
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 135))], spacing: 12) {
                ForEach(NativeMomentShoutout.allCases) { shoutout in
                    Button {
                        model.shoutout = shoutout
                    } label: {
                        VStack {
                            ZStack(alignment: .topTrailing) {
                                Image(shoutout.asset)
                                    .resizable().aspectRatio(1, contentMode: .fit)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                if shoutout.videoResource != nil {
                                    Image(systemName: "play.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(.white)
                                        .shadow(color: .black.opacity(0.55), radius: 3)
                                        .padding(8)
                                }
                            }
                            Label(shoutout.title, systemImage: model.shoutout == shoutout ? "checkmark.circle.fill" : "circle")
                                .font(.caption.bold())
                        }
                        .padding(5)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(
                            model.shoutout == shoutout ? Color.accentColor : .clear, lineWidth: 3))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(shoutout.title) shoutout")
                    .accessibilityAddTraits(model.shoutout == shoutout ? .isSelected : [])
                    .accessibilityIdentifier("record-moments-shoutout-\(shoutout.rawValue)")
                }
            }
            Text("Still artwork and video are fit without cropping. Landscape videos may have black space around them on portrait clips.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var introMusicSection: some View {
        Section("4 · Animated intro music") {
            Toggle("Add intro music", isOn: $model.introMusicEnabled)
                .accessibilityIdentifier("record-moments-music-toggle")
            Text("A short music cue plays only with Clutch · Animated. It fades out before your original video audio begins; no music plays over the action.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    @MainActor
    private func record() async {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            model.error = "This device has no available video camera. Choose a video instead."
            return
        }
        authorizing = true
        defer { authorizing = false }
        let camera = await AVCaptureDevice.requestAccess(for: .video)
        guard camera else {
            model.permissionDenied = true
            model.error = "Allow Camera access in Settings to record a moment. You can still choose an existing video."
            return
        }
        let microphone = await AVCaptureDevice.requestAccess(for: .audio)
        guard microphone else {
            model.permissionDenied = true
            model.error = "Allow Microphone access in Settings to record with sound. You can still choose an existing video."
            return
        }
        if model.preparePicker() { showingCamera = true }
    }
}

private struct NativeMomentTrimTimeline: View {
    @ObservedObject var model: NativeMomentModel
    @State private var startDragOrigin: Double?
    @State private var endDragOrigin: Double?

    private let trackHeight: CGFloat = 76
    private let handleWidth: CGFloat = 30

    var body: some View {
        GeometryReader { geometry in
            let inset = handleWidth / 2
            let trackWidth = max(1, geometry.size.width - handleWidth)
            let duration = max(model.duration, 0.001)
            let startX = inset + trackWidth * CGFloat(model.start / duration)
            let endX = inset + trackWidth * CGFloat((model.start + model.footage) / duration)
            let trackY = trackHeight / 2 + 8

            ZStack(alignment: .topLeading) {
                thumbnailTrack(width: trackWidth)
                    .position(x: geometry.size.width / 2, y: trackY)

                Rectangle()
                    .fill(.black.opacity(0.58))
                    .frame(width: max(0, startX - inset), height: trackHeight)
                    .position(x: inset + max(0, startX - inset) / 2, y: trackY)
                    .allowsHitTesting(false)

                Rectangle()
                    .fill(.black.opacity(0.58))
                    .frame(width: max(0, inset + trackWidth - endX), height: trackHeight)
                    .position(x: endX + max(0, inset + trackWidth - endX) / 2, y: trackY)
                    .allowsHitTesting(false)

                RoundedRectangle(cornerRadius: 7)
                    .stroke(Color.white, lineWidth: 2)
                    .frame(width: max(2, endX - startX), height: trackHeight + 4)
                    .position(x: (startX + endX) / 2, y: trackY)
                    .allowsHitTesting(false)

                handle(
                    title: "START",
                    color: .blue,
                    x: startX,
                    time: model.start,
                    value: String(format: "%.2f seconds", model.start),
                    isStart: true,
                    trackWidth: trackWidth
                )
                handle(
                    title: "END",
                    color: .orange,
                    x: endX,
                    time: model.start + model.footage,
                    value: String(format: "%.2f seconds", model.start + model.footage),
                    isStart: false,
                    trackWidth: trackWidth
                )

                HStack {
                    Text("0:00")
                    Spacer()
                    Text(Self.timeLabel(model.duration))
                }
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
                .position(x: geometry.size.width / 2, y: geometry.size.height - 4)
                .allowsHitTesting(false)
            }
        }
    }

    private func thumbnailTrack(width: CGFloat) -> some View {
        HStack(spacing: 1) {
            ForEach(0..<max(model.thumbnails.count, 12), id: \.self) { index in
                Group {
                    if index < model.thumbnails.count, let image = model.thumbnails[index] {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                    } else {
                        Rectangle()
                            .fill(Color(uiColor: .secondarySystemBackground))
                            .overlay {
                                Image(systemName: "video.fill")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: trackHeight)
                .clipped()
            }
        }
        .frame(width: width, height: trackHeight)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func handle(
        title: String,
        color: Color,
        x: CGFloat,
        time: Double,
        value: String,
        isStart: Bool,
        trackWidth: CGFloat
    ) -> some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(color, in: Capsule())
            RoundedRectangle(cornerRadius: 5)
                .fill(color)
                .frame(width: 22, height: trackHeight - 12)
                .overlay {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 11, weight: .bold))
                        .rotationEffect(.degrees(90))
                        .foregroundStyle(.white)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 5)
                        .stroke(.white, lineWidth: 1.5)
                }
        }
        .frame(width: handleWidth, height: trackHeight + 16)
        .contentShape(Rectangle())
        .position(x: x, y: trackHeight / 2 + 8)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { gesture in
                    let origin: Double
                    if isStart {
                        if startDragOrigin == nil { startDragOrigin = model.start }
                        origin = startDragOrigin ?? model.start
                    } else {
                        if endDragOrigin == nil { endDragOrigin = model.start + model.footage }
                        origin = endDragOrigin ?? (model.start + model.footage)
                    }
                    let shift = Double(gesture.translation.width / trackWidth) * model.duration
                    if isStart {
                        model.setTrimStart(origin + shift)
                    } else {
                        model.setTrimEnd(origin + shift)
                    }
                }
                .onEnded { _ in
                    if isStart { startDragOrigin = nil }
                    else { endDragOrigin = nil }
                }
        )
        .accessibilityElement()
        .accessibilityLabel(isStart ? "Footage start handle" : "Footage end handle")
        .accessibilityValue(value)
        .accessibilityAdjustableAction { direction in
            let step = direction == .increment ? 0.25 : -0.25
            if isStart { model.setTrimStart(time + step) }
            else { model.setTrimEnd(time + step) }
        }
        .accessibilityIdentifier(isStart ? "record-moments-start-handle" : "record-moments-end-handle")
    }

    private static func timeLabel(_ seconds: Double) -> String {
        let total = max(0, Int(seconds))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
