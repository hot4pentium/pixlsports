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
                trimSection
                    .disabled(model.busy)
                shoutoutSection
                    .disabled(model.busy)
                Section(model.output == nil ? "Selected footage preview" : "Finished MP4 preview") {
                    if let player = model.player {
                        VideoPlayer(player: player)
                            .frame(height: 280)
                            .accessibilityIdentifier("record-moments-preview")
                    }
                    Text(model.output == nil
                         ? "Preview shows only your selected footage. Create the clip to preview the intro followed by the footage."
                         : "Check the intro, action, and sound before saving or sharing.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button(model.output == nil ? "Create clip & preview" : "Recreate clip & preview", action: model.export)
                        .accessibilityIdentifier("record-moments-export")
                        .disabled(model.busy || model.plan == nil)
                }
                if model.output != nil {
                    Section("4 · Keep or share") {
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
        .navigationTitle("Record Moments")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }.disabled(model.busy || authorizing)
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
                        model.start, model.footage, model.footage + model.introSeconds))
                .monospacedDigit()
            if model.maximumStart > 0 {
                Slider(value: $model.start, in: 0...model.maximumStart)
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
            Text(String(format: "Shoutout intro · %.1f seconds", model.introSeconds))
            Slider(value: $model.introSeconds, in: NativeMomentPlan.introRange, step: 0.5)
                .accessibilityLabel("Shoutout intro length")
                .accessibilityValue(String(format: "%.1f seconds", model.introSeconds))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 125))], spacing: 12) {
                ForEach(NativeMomentShoutout.allCases) { shoutout in
                    Button {
                        model.shoutout = shoutout
                    } label: {
                        VStack {
                            Image(shoutout.asset)
                                .resizable().aspectRatio(1, contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
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
            Text("Artwork is shown in full, with black space around it when needed. No text or action is cropped.")
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
