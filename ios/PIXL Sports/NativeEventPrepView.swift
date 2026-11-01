import SwiftUI
import ClerkKit

struct NativeEventPrepView: View {
    let event: AthleteFanEvent
    private let clerk: Clerk?
    let embedded: Bool
    let compactContent: Bool
    let onDirtyChange: (Bool) -> Void
    @StateObject private var model: NativeEventToolModel
    @State private var items: [NativePrepItem] = []
    @State private var notes = ""
    @State private var newItem = ""
    @State private var edited = false
    @State private var recoveringPrepDraft = false
    @State private var confirmingLeave = false
    @State private var isManagingFullPrep = false
    @Environment(\.dismiss) private var dismiss

    init(event: AthleteFanEvent, clerk: Clerk, model: NativeEventToolModel? = nil,
         embedded: Bool = false, compactContent: Bool = false,
         onDirtyChange: @escaping (Bool) -> Void = { _ in }) {
        self.event = event
        self.clerk = clerk
        self.embedded = embedded
        self.compactContent = compactContent
        self.onDirtyChange = onDirtyChange
        _model = StateObject(wrappedValue: model ?? NativeEventToolModel(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? "signed-out"
        ))
    }

#if DEBUG
    init(event: AthleteFanEvent, uiTestFixture: NativeEventWorkspaceUITestFixture,
         model: NativeEventToolModel? = nil, embedded: Bool = false, compactContent: Bool = false,
         onDirtyChange: @escaping (Bool) -> Void = { _ in }) {
        precondition(NativeEventWorkspaceUITestFixture.isRequested)
        self.event = event
        self.clerk = nil
        self.embedded = embedded
        self.compactContent = compactContent
        self.onDirtyChange = onDirtyChange
        _model = StateObject(wrappedValue: model ?? NativeEventToolModel(uiTestFixture: uiTestFixture))
    }
#endif

    @ViewBuilder
    private var prepSections: some View {
            Section {
                Label(event.formattedFullDate(timezone: event.timezone), systemImage: "calendar")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .labelStyle(.titleAndIcon)
                    .accessibilityIdentifier("native-prep-date")
            }
            .listRowBackground(Color.white.opacity(0.06))
            if let clerk, model.busy || model.errorMessage != nil {
                Section {
                    NativeToolSaveNotice(model: model, clerk: clerk, hasUnsavedChanges: edited)
                }
                .listRowBackground(Color.white.opacity(0.06))
            }
            if model.workspace != nil {
                Section {
                    readinessSummary
                }
                .listRowBackground(Color.white.opacity(0.06))
                Section {
                    if items.isEmpty {
                        Text("Add your first task below.")
                            .font(.subheadline)
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                    ForEach($items) { $item in
                        Button {
                            item.completed.toggle()
                            edited = true
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                                    .font(.title2)
                                    .foregroundStyle(item.completed ? SupporterHomeColors.accent : SupporterHomeColors.muted)
                                    .accessibilityHidden(true)
                                Text(item.label)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(item.completed ? SupporterHomeColors.muted : .white)
                                    .strikethrough(item.completed)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.label)
                        .accessibilityValue(item.completed ? "Ready" : "Not ready")
                        .accessibilityHint("Mark this task ready or not ready.")
                        .accessibilityIdentifier("native-prep-item-\(item.id)")
                        .contextMenu {
                            Button("Remove task", role: .destructive) {
                                guard !model.busy, model.pending == nil else { return }
                                let id = item.id
                                items.removeAll { $0.id == id }
                                edited = true
                            }
                        }
                    }
                    .onDelete { offsets in
                        items.remove(atOffsets: offsets)
                        edited = true
                    }
                    HStack {
                        TextField("Add a task", text: $newItem)
                            .textInputAutocapitalization(.sentences)
                            .submitLabel(.done)
                            .onSubmit { addTask() }
                            .accessibilityIdentifier("native-prep-add-task")
                        Button(action: addTask) {
                            Label("Add", systemImage: "plus")
                                .font(.subheadline.weight(.bold))
                                .frame(minHeight: 32)
                        }
                        .buttonStyle(.borderedProminent)
                        .foregroundStyle(SupporterHomeColors.background)
                        .disabled(newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || items.count >= 100)
                        .accessibilityIdentifier("native-prep-add")
                    }
                } header: {
                    Label("Checklist", systemImage: "checklist")
                        .font(.caption.weight(.heavy))
                        .foregroundStyle(SupporterHomeColors.accent)
                }
                .listRowBackground(Color.white.opacity(0.06))
                .listRowSeparatorTint(Color.white.opacity(0.10))
                .disabled(model.busy || model.pending != nil)
                Section {
                    TextField("Anything to remember?", text: Binding(
                        get: { notes }, set: { notes = $0; edited = true }
                    ), axis: .vertical)
                        .lineLimit(3...8)
                        .disabled(model.busy || model.pending != nil)
                        .accessibilityIdentifier("native-prep-notes")
                    if notes.count > 4000 {
                        Text("Keep notes under 4,000 characters to save.").foregroundStyle(.red)
                    }
                } header: {
                    Label("Event notes", systemImage: "note.text")
                        .font(.caption.weight(.heavy))
                        .foregroundStyle(SupporterHomeColors.accent)
                }
                .listRowBackground(Color.white.opacity(0.06))
            }
    }

    private var compactPrepContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let clerk, model.busy || model.errorMessage != nil {
                NativeToolSaveNotice(model: model, clerk: clerk, hasUnsavedChanges: edited)
            }

            if model.workspace != nil {
                compactReadinessSummary

                if items.isEmpty {
                    Text("No Prep tasks yet. Open the full list to add some.")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.muted)
                } else {
                    SupporterEyebrow(text: "Your checklist")
                        .padding(.top, 2)
                    VStack(spacing: 8) {
                        ForEach(Array(items.prefix(4))) { item in
                            quickChecklistItem(item)
                        }
                    }
                    if items.count > 4 {
                        Text("\(items.count - 4) more tasks in the full list")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                }
            } else {
                HStack(spacing: 10) {
                    if model.busy || model.errorMessage == nil {
                        ProgressView().tint(SupporterHomeColors.accent)
                        Text("Loading your Prep checklist…")
                            .font(.subheadline)
                            .foregroundStyle(SupporterHomeColors.muted)
                    } else {
                        Text("Your Prep checklist could not be loaded. Retry above.")
                            .font(.subheadline)
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                }
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isManagingFullPrep = true }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "slider.horizontal.3")
                    Text("Manage full Prep")
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right")
                }
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(SupporterPrimaryButtonStyle())
            .accessibilityLabel("Manage full Prep")
            .accessibilityHint("Open the full checklist and event notes.")
            .accessibilityIdentifier("native-prep-manage-full")
        }
        .accessibilityIdentifier("native-prep-quick-content")
    }

    private var compactReadinessSummary: some View {
        HStack(spacing: 13) {
            ZStack {
                Circle()
                    .stroke(SupporterHomeColors.accent.opacity(0.18), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: CGFloat(readyCount) / CGFloat(max(items.count, 1)))
                    .stroke(SupporterHomeColors.accent, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(readyCount)")
                    .font(.system(size: 18, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
            }
            .frame(width: 46, height: 46)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(event.type == "practice" ? "Practice prep" : "Game-day prep")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Text("\(readyCount) of \(items.count) ready")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .accessibilityIdentifier("native-prep-quick-progress")
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Image(systemName: readyCount == items.count && !items.isEmpty ? "checkmark.seal.fill" : "checklist")
                .font(.title3.weight(.semibold))
                .foregroundStyle(SupporterHomeColors.accent)
                .accessibilityHidden(true)
        }
        .padding(13)
        .background(
            LinearGradient(
                colors: [SupporterHomeColors.accent.opacity(0.13), Color.white.opacity(0.035)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 17, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .strokeBorder(SupporterHomeColors.accent.opacity(0.24), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("native-prep-readiness-card")
    }

    private func quickChecklistItem(_ item: NativePrepItem) -> some View {
        Button {
            toggleItem(id: item.id)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(item.completed ? SupporterHomeColors.accent : SupporterHomeColors.muted)
                    .fixedSize()
                    .accessibilityHidden(true)
                Text(item.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(item.completed ? SupporterHomeColors.muted : .white)
                    .strikethrough(item.completed)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .layoutPriority(1)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                item.completed ? SupporterHomeColors.accent.opacity(0.085) : Color.white.opacity(0.045),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(
                        item.completed ? SupporterHomeColors.accent.opacity(0.26) : Color.white.opacity(0.07),
                        lineWidth: 1
                    )
            }
        }
        .buttonStyle(.plain)
        .disabled(model.busy || model.pending != nil)
        .accessibilityLabel(item.label)
        .accessibilityValue(item.completed ? "Ready" : "Not ready")
        .accessibilityHint("Mark this task ready or not ready.")
        .accessibilityIdentifier("native-prep-item-\(item.id)")
    }

    private func prepNavigationLabel(_ title: String, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .fixedSize()
                .accessibilityHidden(true)
            Text(title)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
        }
        .font(.subheadline.weight(.bold))
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }

    var body: some View {
        Group {
            if embedded {
                VStack(alignment: .leading, spacing: 16) {
                    if compactContent && !isManagingFullPrep {
                        compactPrepContent
                    } else {
                        prepSections
                        Text("Press and hold a task to remove it.")
                            .font(.caption)
                            .foregroundStyle(SupporterHomeColors.muted)
                        if compactContent {
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) { isManagingFullPrep = false }
                            } label: {
                                prepNavigationLabel("Back to Content", systemImage: "chevron.left")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(SupporterHomeColors.accent)
                            .accessibilityIdentifier("native-prep-back-to-content")
                        }
                    }
                    if model.workspace != nil { saveFooter }
                }
            } else {
                Form { prepSections }
            }
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background {
            if !embedded { LinearGradient(
                colors: [SupporterHomeColors.background, SupporterHomeColors.panel],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !embedded && model.workspace != nil {
                saveFooter
            }
        }
        .preferredColorScheme(.dark)
        .navigationTitle(embedded ? "Event Details" : "Prep")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(hasUnsavedEdits)
        .toolbar {
            if hasUnsavedEdits {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") { confirmingLeave = true }
                }
            }
        }
        .confirmationDialog("Leave without saving these prep edits?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave without saving", role: .destructive) { dismiss() }
        }
        .tint(SupporterHomeColors.accent)
        .task {
            guard !hasUnsavedEdits else { return }
            if model.workspace == nil, let clerk { await model.load(clerk: clerk) }
            applySavedPrep()
        }
        .onChange(of: hasUnsavedEdits) { _, value in onDirtyChange(value) }
#if DEBUG
        .safeAreaInset(edge: .top) {
            if NativeEventWorkspaceUITestFixture.isRequested,
               !ProcessInfo.processInfo.arguments.contains("--prep-long-labels") {
                NativePrepDraftUITestControls()
            }
        }
#endif
        .onChange(of: model.workspace?.prepRevision) { _, _ in
            if let prep = model.workspace?.prep, prep.items == items && prep.notes == notes && model.pending == nil {
                edited = false
                recoveringPrepDraft = false
            } else if !edited {
                applySavedPrep()
            }
        }
        .onChange(of: model.reloadGeneration) { _, _ in
            // Discarding a failed tracker command must not discard an unrelated Prep draft.
            if recoveringPrepDraft || !hasUnsavedEdits { applySavedPrep() }
        }
    }

    private var readyCount: Int { items.filter(\.completed).count }
    private var hasUnsavedEdits: Bool {
        edited || !newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var readinessSummary: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().stroke(SupporterHomeColors.accent.opacity(0.14), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: CGFloat(readyCount) / CGFloat(max(items.count, 1)))
                    .stroke(SupporterHomeColors.accent, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(readyCount)")
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
            }
            .frame(width: 58, height: 58)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(event.type == "practice" ? "Practice prep" : "Game-day prep")
                    .font(.title3.weight(.heavy))
                    .foregroundStyle(.white)
                Text("\(readyCount) of \(items.count) ready")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("native-prep-readiness")
    }

    private var canSave: Bool {
        edited && !model.busy && model.pending == nil && notes.count <= 4000
    }

    private var saveFooter: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.busy ? "Updating prep…" : hasUnsavedEdits ? "Unsaved changes" : "Prep saved")
                .font(.caption.weight(.semibold))
                .foregroundStyle(SupporterHomeColors.muted)
            Button("Save Prep") {
                Task {
                    guard let clerk else {
                        // Test workspaces must never send or pretend to save.
                        model.errorMessage = "This UI-test workspace cannot save."
                        return
                    }
                    recoveringPrepDraft = true
                    await model.save("prep", clerk: clerk, items: items, notes: notes)
                    if model.errorMessage == nil && model.pending == nil {
                        edited = false
                        recoveringPrepDraft = false
                    }
                }
            }
            .buttonStyle(SupporterPrimaryButtonStyle())
            .disabled(!canSave)
            .opacity(canSave ? 1 : 0.5)
            .accessibilityIdentifier("native-prep-save")
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(SupporterHomeColors.background.opacity(0.98))
        .overlay(alignment: .top) {
            Rectangle().fill(Color.white.opacity(0.10)).frame(height: 1)
        }
    }

    private func addTask() {
        let label = String(newItem.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !model.busy, model.pending == nil, !label.isEmpty, items.count < 100 else { return }
        items.append(NativePrepItem(id: UUID().uuidString, label: label, completed: false))
        newItem = ""
        edited = true
    }

    private func toggleItem(id: String) {
        guard !model.busy, model.pending == nil,
              let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].completed.toggle()
        edited = true
    }

    private func applySavedPrep() {
        guard let prep = model.workspace?.prep else { return }
        // A failed save may be newer than the server; keep its exact draft.
        items = model.pending?.items ?? prep.items
        notes = model.pending?.notes ?? prep.notes
        recoveringPrepDraft = model.pending?.items != nil || model.pending?.notes != nil
        edited = recoveringPrepDraft
    }
}

#if DEBUG
private struct NativePrepDraftUITestControls: View {
    @ObservedObject private var fixture = NativeEventWorkspaceUITestFixture.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack {
            Text("Next: \(fixture.recommendation)")
                .accessibilityIdentifier("prep-test-recommendation")
            Text("\(fixture.timelineTicks)")
                .accessibilityIdentifier("prep-test-timeline-ticks")
            Text("\(fixture.resumes)")
                .accessibilityIdentifier("prep-test-resumes")
            Button("Advance test clock") { fixture.advanceClock() }
                .accessibilityIdentifier("prep-test-advance-clock")
        }
        .font(.caption)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { fixture.recordResume() }
        }
    }
}
#endif
