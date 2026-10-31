import SwiftUI
import ClerkKit

struct NativeEventPrepView: View {
    let event: AthleteFanEvent
    let clerk: Clerk
    let embedded: Bool
    let onDirtyChange: (Bool) -> Void
    @StateObject private var model: NativeEventToolModel
    @State private var items: [NativePrepItem] = []
    @State private var notes = ""
    @State private var newItem = ""
    @State private var edited = false
    @State private var recoveringPrepDraft = false
    @State private var confirmingLeave = false
    @Environment(\.dismiss) private var dismiss

    init(event: AthleteFanEvent, clerk: Clerk, model: NativeEventToolModel? = nil,
         embedded: Bool = false, onDirtyChange: @escaping (Bool) -> Void = { _ in }) {
        self.event = event
        self.clerk = clerk
        self.embedded = embedded
        self.onDirtyChange = onDirtyChange
        _model = StateObject(wrappedValue: model ?? NativeEventToolModel(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? "signed-out"
        ))
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
            .listRowBackground(Color.white.opacity(0.06))
            if model.busy || model.errorMessage != nil {
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

    var body: some View {
        Group {
            if embedded {
                VStack(alignment: .leading, spacing: 16) {
                    prepSections
                    Text("Press and hold a task to remove it.")
                        .font(.caption)
                        .foregroundStyle(SupporterHomeColors.muted)
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
            if model.workspace == nil { await model.load(clerk: clerk) }
            applySavedPrep()
        }
        .onChange(of: hasUnsavedEdits) { _, value in onDirtyChange(value) }
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

    private func applySavedPrep() {
        guard let prep = model.workspace?.prep else { return }
        // A failed save may be newer than the server; keep its exact draft.
        items = model.pending?.items ?? prep.items
        notes = model.pending?.notes ?? prep.notes
        recoveringPrepDraft = model.pending?.items != nil || model.pending?.notes != nil
        edited = recoveringPrepDraft
    }
}
