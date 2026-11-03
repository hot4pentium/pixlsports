import SwiftUI
import ClerkKit

struct NativeEventPrepView: View {
    let event: AthleteFanEvent
    private let clerk: Clerk?
    let embedded: Bool
    let compactContent: Bool
    let onDirtyChange: (Bool) -> Void
    @StateObject private var model: NativeEventToolModel
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    @State private var items: [NativePrepItem] = []
    @State private var notes = ""
    @State private var notesDirty = false
    @State private var newItem = ""
    @State private var editingTaskID: String?
    @State private var editingTaskText = ""
    @State private var edited = false
    @State private var prepAutosaveTask: Task<Void, Never>?
    @State private var recoveringPrepDraft = false
    @State private var confirmingLeave = false
    @State private var isManagingFullPrep = false
    @State private var isChecklistExpanded = true
    @State private var hasInitializedChecklistExpansion = false
    @State private var showCompletionCelebration = false
    @State private var completionCelebrationID = 0
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var isTaskEditorFocused: Bool

    init(event: AthleteFanEvent, clerk: Clerk, model: NativeEventToolModel? = nil,
         embedded: Bool = false, compactContent: Bool = false,
         onDirtyChange: @escaping (Bool) -> Void = { _ in }) {
        self.event = event
        self.clerk = clerk
        self.embedded = embedded
        self.compactContent = compactContent
        self.onDirtyChange = onDirtyChange
        _model = StateObject(wrappedValue: model ?? NativeEventToolModel.shared(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? NativeOfflineRuntime.shared.accountID
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

    private var taskEntryText: String {
        editingTaskID == nil ? newItem : editingTaskText
    }

    private var taskEntryBinding: Binding<String> {
        Binding(
            get: { editingTaskID == nil ? newItem : editingTaskText },
            set: { value in
                if editingTaskID == nil { newItem = value }
                else { editingTaskText = value }
            }
        )
    }

    private var canSubmitTaskEntry: Bool {
        let label = taskEntryText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard model.canEditLocally, !label.isEmpty else { return false }
        if let editingTaskID {
            return items.contains { $0.id == editingTaskID }
        }
        return items.count < 100
    }

    private var hasUnsavedTaskEntry: Bool {
        let label = taskEntryText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let editingTaskID, let original = items.first(where: { $0.id == editingTaskID }) {
            return label != original.label
        }
        return editingTaskID == nil && !label.isEmpty
    }

    private var shouldShowSaveNotice: Bool {
        model.errorMessage != nil || model.conflictBlocked || model.unreadablePendingData || !offline.online
    }

    @ViewBuilder
    private var prepSections: some View {
            Section {
                Label(event.formattedFullDate(timezone: event.timezone), systemImage: "calendar")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .labelStyle(.titleAndIcon)
                    .accessibilityIdentifier("native-prep-date")
            }
            .listRowBackground(SupporterHomeColors.panel)
            if let clerk, shouldShowSaveNotice {
                Section {
                    NativeToolSaveNotice(
                        model: model, clerk: clerk, hasUnsavedChanges: edited,
                        savedContentName: "Prep", onKeepLocalPrep: { await keepLocalPrepChanges() }
                    )
                }
                .listRowBackground(SupporterHomeColors.panel)
            }
            if model.workspace != nil {
                if showCompletionCelebration {
                    Section {
                        completionCelebration
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
                Section {
                    readinessSummary
                }
                .listRowBackground(SupporterHomeColors.panel)
                Section {
                    if items.isEmpty {
                        Text("Add your first task below.")
                            .font(.subheadline)
                            .foregroundStyle(SupporterHomeColors.muted)
                    } else {
                        if isChecklistExpanded {
                            ForEach($items) { $item in
                                Button {
                                    toggleItem(id: item.id)
                                } label: {
                                    HStack(alignment: .top, spacing: 12) {
                                        Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                                            .font(.title2)
                                            .foregroundStyle(item.completed ? NativeEventToolColors.prep : SupporterHomeColors.muted)
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
                                     Button {
                                         beginEditingTask(item)
                                     } label: {
                                         Label("Edit task", systemImage: "pencil")
                                     }
                                    Button("Remove task", role: .destructive) {
                                         removeTask(id: item.id)
                                    }
                                }
                            }
                            .onDelete { offsets in
                                 if let editingTaskID,
                                    offsets.contains(where: { items.indices.contains($0) && items[$0].id == editingTaskID }) {
                                     cancelTaskEdit()
                                 }
                                items.remove(atOffsets: offsets)
                                edited = true
                                scheduleChecklistAutosave()
                            }
                        }
                    }
                    HStack(spacing: 8) {
                        let taskEntryPlaceholder = editingTaskID == nil ? "Add a task" : "Edit task"
                        TextField(
                            taskEntryPlaceholder, text: taskEntryBinding,
                            prompt: Text(taskEntryPlaceholder).foregroundColor(.white.opacity(0.76))
                        )
                            .textInputAutocapitalization(.sentences)
                            .submitLabel(.done)
                            .foregroundStyle(.white)
                            .environment(\.colorScheme, .dark)
                            .tint(NativeEventToolColors.prep)
                            .padding(12)
                            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                            .overlay {
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(.white.opacity(0.22), lineWidth: 1)
                            }
                            .onSubmit { saveTaskEntry() }
                            .focused($isTaskEditorFocused)
                            .accessibilityIdentifier(editingTaskID == nil ? "native-prep-add-task" : "native-prep-edit-task")
                        if editingTaskID != nil {
                            Button("Cancel", action: cancelTaskEdit)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(SupporterHomeColors.muted)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("native-prep-cancel-edit")
                        }
                        Button(action: saveTaskEntry) {
                            Label(editingTaskID == nil ? "Add" : "Update",
                                  systemImage: editingTaskID == nil ? "plus" : "checkmark")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(canSubmitTaskEntry ? SupporterHomeColors.background : .white.opacity(0.78))
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .background(
                                    canSubmitTaskEntry ? NativeEventToolColors.prep : .white.opacity(0.12),
                                    in: RoundedRectangle(cornerRadius: 12)
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(!canSubmitTaskEntry)
                        .accessibilityIdentifier(editingTaskID == nil ? "native-prep-add" : "native-prep-update-task")
                    }
                } header: {
                    Label("Checklist", systemImage: "checklist")
                        .font(.caption.weight(.heavy))
                        .foregroundStyle(NativeEventToolColors.prep)
                }
                .listRowBackground(SupporterHomeColors.panel)
                .listRowSeparatorTint(Color.white.opacity(0.10))
                .disabled(!model.canEditLocally)
                Section {
                    TextField(
                        "Anything to remember?",
                        text: Binding(get: { notes }, set: {
                            notes = $0; notesDirty = true; edited = true
                            persistDraft()
                        }),
                        prompt: Text("Anything to remember?").foregroundColor(.white.opacity(0.76)),
                        axis: .vertical
                    )
                        .lineLimit(3...8)
                        .foregroundStyle(.white)
                        .environment(\.colorScheme, .dark)
                        .tint(NativeEventToolColors.prep)
                        .padding(12)
                        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(.white.opacity(0.22), lineWidth: 1)
                        }
                        .disabled(!model.canEditLocally)
                        .accessibilityIdentifier("native-prep-notes")
                    if notes.count > 4000 {
                        Text("Keep notes under 4,000 characters to save.").foregroundStyle(.red)
                    }
                } header: {
                    Label("Event notes", systemImage: "note.text")
                        .font(.caption.weight(.heavy))
                        .foregroundStyle(NativeEventToolColors.prep)
                }
                .listRowBackground(SupporterHomeColors.panel)
            }
    }

    private var compactPrepContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let clerk, shouldShowSaveNotice {
                NativeToolSaveNotice(
                    model: model, clerk: clerk, hasUnsavedChanges: edited,
                    savedContentName: "Prep", onKeepLocalPrep: { await keepLocalPrepChanges() }
                )
            }

            if model.workspace != nil {
                compactReadinessSummary

                if items.isEmpty {
                    Text("No Prep tasks yet. Add tasks or event notes in Manage.")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.muted)
                } else if isChecklistExpanded {
                    VStack(spacing: 8) {
                        ForEach(items) { item in
                            quickChecklistItem(item)
                        }
                    }
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .move(edge: .top).combined(with: .opacity)
                    )
                }
            } else {
                HStack(spacing: 10) {
                    if model.busy || model.errorMessage == nil {
                        ProgressView().tint(NativeEventToolColors.prep)
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

            if showCompletionCelebration {
                completionCelebration
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isManagingFullPrep = true }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "slider.horizontal.3")
                    Text("Manage tasks & notes")
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right")
                }
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(SupporterPrimaryButtonStyle(fillColor: NativeEventToolColors.prep))
            .accessibilityLabel("Manage tasks and event notes")
            .accessibilityHint("Add or remove checklist tasks and edit event notes.")
            .accessibilityIdentifier("native-prep-manage-full")
        }
        .accessibilityIdentifier("native-prep-quick-content")
    }

    private var compactReadinessSummary: some View {
        readinessHeader(compact: true)
            .padding(13)
            .background(
                LinearGradient(
                    colors: [NativeEventToolColors.prep.opacity(0.15), Color.white.opacity(0.035)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(NativeEventToolColors.prep.opacity(0.32), lineWidth: 1)
            }
    }

    private var completionCelebration: some View {
        HStack(spacing: 12) {
            Image(systemName: "party.popper.fill")
                .font(.title2.weight(.bold))
                .foregroundStyle(NativeEventToolColors.prep)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("Prep complete!")
                    .font(.headline.weight(.black))
                    .foregroundStyle(.white)
                Text(event.type == "practice" ? "You're ready for practice." : "You're ready for game day.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "sparkles")
                .font(.title3.weight(.bold))
                .foregroundStyle(NativeEventToolColors.prep)
                .accessibilityHidden(true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [NativeEventToolColors.prep.opacity(0.22), NativeEventToolColors.prep.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 17, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .strokeBorder(NativeEventToolColors.prep.opacity(0.48), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("native-prep-completion-celebration")
        .transition(
            reduceMotion
                ? .opacity
                : .scale(scale: 0.96).combined(with: .opacity)
        )
    }

    private func quickChecklistItem(_ item: NativePrepItem) -> some View {
        Button {
            toggleItem(id: item.id)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(item.completed ? NativeEventToolColors.prep : SupporterHomeColors.muted)
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
                item.completed ? NativeEventToolColors.prep.opacity(0.11) : Color.white.opacity(0.045),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(
                        item.completed ? NativeEventToolColors.prep.opacity(0.34) : Color.white.opacity(0.07),
                        lineWidth: 1
                    )
            }
        }
        .buttonStyle(.plain)
        .disabled(!model.canEditLocally)
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
                        if compactContent {
                            VStack(alignment: .leading, spacing: 5) {
                                Text("Manage tasks & event notes")
                                    .font(.headline.weight(.bold))
                                    .foregroundStyle(.white)
                                Text("Add or remove checklist tasks and keep event notes here.")
                                    .font(.subheadline)
                                    .foregroundStyle(SupporterHomeColors.muted)
                            }
                            .accessibilityIdentifier("native-prep-management-title")
                        }
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
                            .foregroundStyle(NativeEventToolColors.prep)
                            .accessibilityIdentifier("native-prep-back-to-content")
                        }
                    }
                    if model.workspace != nil && !shouldShowSaveNotice { saveFooter }
                }
            } else {
                Form { prepSections }
            }
        }
        .foregroundStyle(.white)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background {
            if !embedded { NativePageBackground() }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !embedded && model.workspace != nil && !shouldShowSaveNotice {
                saveFooter
            }
        }
        .preferredColorScheme(.light)
        .eventToolNavigationTitle("Prep", embedded: embedded)
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
        .tint(NativeEventToolColors.prep)
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
        .onChange(of: model.pendingCount) { _, count in
            guard count == 0,
                  let prep = model.workspace?.prep,
                  prep.items == items,
                  prep.notes == notes else { return }
            edited = false
            recoveringPrepDraft = false
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active, prepAutosaveTask != nil else { return }
            prepAutosaveTask?.cancel()
            Task { await savePrepChanges(includeNotes: false) }
        }
        .task(id: completionCelebrationID) {
            guard showCompletionCelebration else { return }
            try? await Task.sleep(for: .seconds(2.8))
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                showCompletionCelebration = false
            }
        }
    }

    private var readyCount: Int { items.filter(\.completed).count }
    private var isChecklistComplete: Bool { !items.isEmpty && items.allSatisfy(\.completed) }
    private var checklistAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.84)
    }

    private var hasUnsavedEdits: Bool {
        edited || !newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || (editingTaskID != nil && hasUnsavedTaskEntry)
    }

    private var readinessSummary: some View {
        readinessHeader(compact: false)
    }

    private func toggleChecklist() {
        withAnimation(checklistAnimation) {
            isChecklistExpanded.toggle()
        }
    }

    private func readinessHeader(compact: Bool) -> some View {
        HStack(spacing: 8) {
            Button(action: toggleChecklist) {
                HStack(spacing: compact ? 13 : 16) {
                    ZStack {
                        Circle().stroke(NativeEventToolColors.prep.opacity(0.18), lineWidth: 5)
                        Circle()
                            .trim(from: 0, to: CGFloat(readyCount) / CGFloat(max(items.count, 1)))
                            .stroke(NativeEventToolColors.prep, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(readyCount)")
                            .font(.system(size: compact ? 18 : 22, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                    }
                    .frame(width: compact ? 46 : 58, height: compact ? 46 : 58)
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: compact ? 3 : 5) {
                        Text(event.type == "practice" ? "Practice prep" : "Game-day prep")
                            .font(compact ? .headline.weight(.bold) : .title3.weight(.heavy))
                            .foregroundStyle(.white)
                        Text("\(readyCount) of \(items.count) ready")
                            .font(compact ? .subheadline.weight(.semibold) : .subheadline)
                            .foregroundStyle(SupporterHomeColors.muted)
                            .accessibilityIdentifier("native-prep-quick-progress")
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, minHeight: compact ? 54 : 58, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(event.type == "practice" ? "Practice prep" : "Game-day prep")
            .accessibilityValue(
                "\(readyCount) of \(items.count) ready. \(isChecklistExpanded ? "Expanded" : "Collapsed")"
            )
            .accessibilityHint(isChecklistExpanded ? "Collapse the prep checklist." : "Expand the prep checklist.")
            .accessibilityIdentifier("native-prep-checklist-toggle")

            Button("Save") {
                Task { await savePrepChanges() }
            }
            .buttonStyle(SupporterPrimaryButtonStyle(fillColor: NativeEventToolColors.prep))
            .fixedSize(horizontal: true, vertical: false)
            .disabled(!canSave)
            .opacity(canSave ? 1 : 0.5)
            .accessibilityIdentifier("native-prep-save")

            Button(action: toggleChecklist) {
                Image(systemName: isChecklistExpanded ? "chevron.up" : "chevron.down")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(NativeEventToolColors.prep)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // The larger title/progress button exposes this same action to VoiceOver.
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var canSave: Bool {
        edited && model.canEditLocally && notes.count <= 4000
    }

    private var saveStatusText: String {
        if model.conflictBlocked { return "Prep update wasn't saved" }
        if model.errorMessage != nil { return "See the message above" }
        if prepAutosaveTask != nil || model.busy { return "Saving…" }
        if model.pendingCount > 0 { return "Changes still need saving" }
        if !offline.online { return "Offline · saved copy on this iPhone" }
        if hasUnsavedEdits { return "Unsaved changes" }
        return "Prep saved"
    }

    private var saveFooter: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(saveStatusText)
                .font(.caption2.weight(.medium))
                .foregroundStyle(SupporterHomeColors.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(minHeight: 16, alignment: .leading)
                .accessibilityIdentifier("native-prep-save-status")
                .transaction { $0.animation = nil }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
    }

    private func saveTaskEntry() {
        let label = String(taskEntryText.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard model.canEditLocally, !label.isEmpty else { return }

        if let editingTaskID {
            guard let index = items.firstIndex(where: { $0.id == editingTaskID }) else {
                cancelTaskEdit()
                return
            }
            if items[index].label != label {
                items[index].label = label
                edited = true
                scheduleChecklistAutosave()
            }
            cancelTaskEdit()
            return
        }

        guard items.count < 100 else { return }
        items.append(NativePrepItem(id: UUID().uuidString, label: label, completed: false))
        newItem = ""
        edited = true
        scheduleChecklistAutosave()
        withAnimation(checklistAnimation) {
            isChecklistExpanded = true
            showCompletionCelebration = false
        }
    }

    private func beginEditingTask(_ item: NativePrepItem) {
        guard model.canEditLocally else { return }
        editingTaskID = item.id
        editingTaskText = item.label
        isTaskEditorFocused = true
    }

    private func cancelTaskEdit() {
        editingTaskID = nil
        editingTaskText = ""
        isTaskEditorFocused = false
    }

    private func removeTask(id: String) {
        guard model.canEditLocally else { return }
        if editingTaskID == id { cancelTaskEdit() }
        items.removeAll { $0.id == id }
        edited = true
        scheduleChecklistAutosave()
    }

    private func toggleItem(id: String) {
        guard model.canEditLocally,
              let index = items.firstIndex(where: { $0.id == id }) else { return }
        let wasComplete = isChecklistComplete
        items[index].completed.toggle()
        if clerk != nil && !persistDraft() {
            items[index].completed.toggle()
            return
        }
        edited = true
        scheduleChecklistAutosave()

        if !items[index].completed {
            withAnimation(checklistAnimation) {
                if compactContent { isChecklistExpanded = true }
                showCompletionCelebration = false
            }
        } else if !wasComplete && isChecklistComplete {
            withAnimation(checklistAnimation) {
                isChecklistExpanded = false
                showCompletionCelebration = true
                completionCelebrationID += 1
            }
        }
    }

    private func applySavedPrep() {
        guard let prep = model.workspace?.prep else { return }
        // A failed save may be newer than the server; keep its exact draft.
        items = prep.items
        notes = prep.notes
        notesDirty = false
        if let data = try? NativeOfflineVault.shared.read("draft/" + event.shareToken),
           let draft = try? JSONDecoder().decode(PrepDraft.self, from: data) {
            if draft.checklistDirty { items = draft.items }
            if draft.notesDirty { notes = draft.notes; notesDirty = true }
            recoveringPrepDraft = draft.checklistDirty || draft.notesDirty
            if draft.checklistDirty { scheduleChecklistAutosave() }
        } else { recoveringPrepDraft = false }
        edited = recoveringPrepDraft
        if !hasInitializedChecklistExpansion {
            isChecklistExpanded = !isChecklistComplete
            hasInitializedChecklistExpansion = true
        }
    }

    private func scheduleChecklistAutosave() {
        guard clerk != nil, model.workspace != nil else { return }
        guard persistDraft() else { return }
        prepAutosaveTask?.cancel()
        prepAutosaveTask = Task {
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled else { return }
            await savePrepChanges(includeNotes: false)
        }
    }

    private func savePrepChanges(includeNotes: Bool = true) async {
        prepAutosaveTask?.cancel()
        prepAutosaveTask = nil
        guard let clerk else {
            // Test workspaces must never send or pretend to save.
            model.errorMessage = "This UI-test workspace cannot save."
            return
        }
        guard edited, model.canEditLocally else { return }
        recoveringPrepDraft = true
        let submittedItems = items
        let submittedNotes = includeNotes ? notes : (model.workspace?.prep.notes ?? "")
        await model.save("prep", clerk: clerk, items: submittedItems, notes: submittedNotes)
        if model.errorMessage == nil {
            if includeNotes && notes == submittedNotes { notesDirty = false }
            edited = notesDirty || items != model.workspace?.prep.items
            recoveringPrepDraft = edited
            persistDraft()
        }
    }

    private func keepLocalPrepChanges() async {
        guard let clerk else { return }
        edited = true
        recoveringPrepDraft = true
        await model.keepLocalPrep(clerk: clerk, items: items, notes: notes, notesDirty: notesDirty)
        if !notesDirty, let savedNotes = model.workspace?.prep.notes { notes = savedNotes }
        guard model.pendingCount == 0,
              model.errorMessage == nil,
              let savedPrep = model.workspace?.prep,
              savedPrep.items == items,
              savedPrep.notes == notes else { return }
        notesDirty = false
        edited = false
        recoveringPrepDraft = false
        persistDraft()
    }

    private typealias PrepDraft = NativeOfflinePrepDraft

    @discardableResult
    private func persistDraft() -> Bool {
        guard clerk != nil else { return true }
        guard model.ownsCurrentScope else { return false }
        do {
            let dirty = items != model.workspace?.prep.items
            let data = dirty || notesDirty ? try JSONEncoder().encode(
                PrepDraft(items: items, notes: notes, notesDirty: notesDirty, checklistDirty: dirty,
                          baseRevision: model.workspace?.prepRevision)) : nil
            try NativeOfflineVault.shared.write(data, key: "draft/" + event.shareToken)
            NativeOfflineRuntime.shared.storageChanged()
            return true
        } catch {
            model.errorMessage = "These edits are not saved on this iPhone. \(error.localizedDescription)"
            return false
        }
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
