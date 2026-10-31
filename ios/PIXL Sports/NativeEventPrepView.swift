import SwiftUI
import ClerkKit

struct NativeEventPrepView: View {
    let event: AthleteFanEvent
    let clerk: Clerk
    @StateObject private var model: NativeEventToolModel
    @State private var items: [NativePrepItem] = []
    @State private var notes = ""
    @State private var newItem = ""
    @State private var edited = false
    @State private var confirmingLeave = false
    @Environment(\.dismiss) private var dismiss

    init(event: AthleteFanEvent, clerk: Clerk) {
        self.event = event
        self.clerk = clerk
        _model = StateObject(wrappedValue: NativeEventToolModel(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? "signed-out"
        ))
    }

    var body: some View {
        Form {
            Section {
                Text(event.title).font(.headline)
                Label(event.formattedFullDate(timezone: event.timezone), systemImage: "calendar")
                Label(event.formattedTime(timezone: event.timezone), systemImage: "clock")
                if !event.location.isEmpty {
                    Label(event.location, systemImage: "mappin.and.ellipse")
                }
            }
            Section {
                NativeToolSaveNotice(model: model, clerk: clerk, hasUnsavedChanges: edited)
            }
            if model.workspace != nil {
                Section {
                    ProgressView(value: Double(items.filter(\.completed).count), total: Double(max(items.count, 1)))
                        .tint(SupporterHomeColors.accent)
                    Text("\(items.filter(\.completed).count) of \(items.count) ready")
                        .font(.caption)
                } header: { Text(event.type == "practice" ? "Practice prep" : "Game-day prep") }
                Section("Checklist") {
                    ForEach($items) { $item in
                        Toggle(item.label, isOn: Binding(
                            get: { item.completed },
                            set: { item.completed = $0; edited = true }
                        ))
                    }
                    .onDelete { offsets in
                        items.remove(atOffsets: offsets)
                        edited = true
                    }
                    HStack {
                        TextField("Add a task", text: $newItem)
                        Button("Add") {
                            let label = String(newItem.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
                            guard !label.isEmpty, items.count < 100 else { return }
                            items.append(NativePrepItem(id: UUID().uuidString, label: label, completed: false))
                            newItem = ""
                            edited = true
                        }
                        .disabled(newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || items.count >= 100)
                    }
                }
                .disabled(model.busy || model.pending != nil)
                Section("Event notes") {
                    TextField("Anything to remember?", text: Binding(
                        get: { notes }, set: { notes = $0; edited = true }
                    ), axis: .vertical)
                        .lineLimit(3...8)
                        .disabled(model.busy || model.pending != nil)
                    if notes.count > 4000 {
                        Text("Keep notes under 4,000 characters to save.").foregroundStyle(.red)
                    }
                    Button("Save prep") {
                        Task {
                            await model.save("prep", clerk: clerk, items: items, notes: notes)
                            if model.errorMessage == nil && model.pending == nil { edited = false }
                        }
                    }
                    .font(.headline)
                    .disabled(!edited || model.busy || model.pending != nil || notes.count > 4000)
                }
            }
        }
        .navigationTitle("Prep")
        .navigationBarBackButtonHidden(edited)
        .toolbar {
            if edited {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") { confirmingLeave = true }
                }
            }
        }
        .confirmationDialog("Leave without saving these prep edits?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave without saving", role: .destructive) { dismiss() }
        }
        .tint(SupporterHomeColors.blue)
        .task {
            await model.load(clerk: clerk)
            applySavedPrep()
        }
        .onChange(of: model.workspace?.prepRevision) { _, _ in
            if let prep = model.workspace?.prep, prep.items == items && prep.notes == notes && model.pending == nil {
                edited = false
            } else if !edited {
                applySavedPrep()
            }
        }
        .onChange(of: model.reloadGeneration) { _, _ in applySavedPrep() }
    }

    private func applySavedPrep() {
        guard let prep = model.workspace?.prep else { return }
        // A failed save may be newer than the server; keep its exact draft.
        items = model.pending?.items ?? prep.items
        notes = model.pending?.notes ?? prep.notes
        edited = model.pending != nil
    }
}
