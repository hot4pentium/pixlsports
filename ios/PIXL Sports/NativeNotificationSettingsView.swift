#if os(iOS)
import ClerkKit
import Combine
import SwiftUI
import UserNotifications

private struct NativeNotificationAvailability: Decodable {
    let available: Bool
    let scheduledDeliveryEnabled: Bool
}

private struct NativeEventReminderPreferences: Codable {
    var oneHourBefore: Bool
    var dayOf: Bool
    var timezone: String?
}

private struct NativeEventReminderPreferencesBody: Encodable {
    let oneHourBefore: Bool
    let dayOf: Bool
    let timezone: String
}

private struct NativeAccountDeletionPreview: Decodable, Identifiable {
    let scope: String
    let target: String
    let title: String
    let explanation: String
    let status: String
    var id: String { target }
    var actionTitle: String { scope == "independent" ? "Delete iPhone account" : "Remove iPhone access" }
}

private struct NativeAccountDeletionBody: Encodable {
    let scope: String
    let target: String
    let confirmation = "DELETE"
}

@MainActor
private final class NativeNotificationSettingsModel: ObservableObject {
    @Published var preferences = NativeEventReminderPreferences(
        oneHourBefore: false,
        dayOf: false,
        timezone: TimeZone.current.identifier
    )
    @Published var availability: NativeNotificationAvailability?
    @Published var isLoading = true
    @Published var isLinked = true
    @Published var errorMessage: String?

    private let client = NativeAccountLinkClient()

    func load(clerk: Clerk) async {
        isLoading = true
        errorMessage = nil
        do {
            let availabilityData = try await client.getData("notifications/config", clerk: clerk)
            availability = try JSONDecoder().decode(
                NativeNotificationAvailability.self,
                from: availabilityData
            )
            let preferencesData = try await client.getData("notifications/preferences", clerk: clerk)
            preferences = try JSONDecoder().decode(
                NativeEventReminderPreferences.self,
                from: preferencesData
            )
            if preferences.timezone == nil {
                preferences.timezone = TimeZone.current.identifier
            }
            isLinked = true
        } catch let error as NativeAccountLinkError {
            if case let .serverStatus(status, _) = error, status == 409 {
                isLinked = false
                errorMessage = nil
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func save(
        oneHourBefore: Bool? = nil,
        dayOf: Bool? = nil,
        timezone: String? = nil,
        clerk: Clerk
    ) async {
        var next = preferences
        if let oneHourBefore { next.oneHourBefore = oneHourBefore }
        if let dayOf { next.dayOf = dayOf }
        if let timezone { next.timezone = timezone }
        let body = NativeEventReminderPreferencesBody(
            oneHourBefore: next.oneHourBefore,
            dayOf: next.dayOf,
            timezone: next.timezone ?? TimeZone.current.identifier
        )
        do {
            let data = try await client.postData(
                "notifications/preferences",
                body: body,
                method: "PATCH",
                clerk: clerk
            )
            preferences = try JSONDecoder().decode(NativeEventReminderPreferences.self, from: data)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct NativeNotificationSettingsView: View {
    @AppStorage("pixl.native.account-removal-receipt") private var accountRemovalReceiptScope = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var pushCoordinator: NativePushRegistrationCoordinator
    @StateObject private var model = NativeNotificationSettingsModel()
    @State private var deletionPreview: NativeAccountDeletionPreview?
    @State private var removalBusy = false
    @State private var removalAccepted = false
    @State private var removalError: String?

    let clerk: Clerk

    private var timezoneOptions: [String] {
        Array(Set([TimeZone.current.identifier] + TimeZone.knownTimeZoneIdentifiers)).sorted()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("iPhone sign-in") {
                    Label("PIXL Sports account", systemImage: "person.crop.circle")
                    Text("Your account keeps your athlete profile, Event Cards, and alert preferences together.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Sign out of iPhone account", role: .destructive) {
                        Task { await signOut() }
                    }
                    .accessibilityIdentifier("native-settings-sign-out")
                }

                Section("Athlete profile") {
                    if model.isLinked {
                        NavigationLink {
                            NativeAthleteProfileView(clerk: clerk)
                        } label: {
                            Label("Edit athlete details", systemImage: "person.text.rectangle")
                        }
                        .accessibilityIdentifier("native-settings-athlete-profile")
                    } else {
                        Text("Connect your PIXL account from the home screen before editing athlete details.")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Event Card alerts") {
                    if model.isLoading {
                        ProgressView("Loading alert settings")
                    } else if !model.isLinked {
                        Text("Connect your PIXL account from the home screen before setting Event Card alerts.")
                            .foregroundStyle(.secondary)
                    } else {
                        Toggle("Allow alerts on this iPhone", isOn: Binding(
                            get: { pushCoordinator.isEnabled },
                            set: { enabled in Task { await setDeviceAlerts(enabled) } }
                        ))
                        .disabled(availabilityIsUnavailable)
                        .accessibilityIdentifier("native-settings-device-alerts")

                        if pushCoordinator.authorizationStatus == .denied {
                            Button("Open iPhone notification settings") {
                                pushCoordinator.openSystemSettings()
                            }
                        }

                        Toggle("One hour before", isOn: Binding(
                            get: { model.preferences.oneHourBefore },
                            set: { value in Task { await save(oneHourBefore: value) } }
                        ))
                        .disabled(model.isLoading)

                        Toggle("Event day", isOn: Binding(
                            get: { model.preferences.dayOf },
                            set: { value in Task { await save(dayOf: value) } }
                        ))
                        .disabled(model.isLoading)

                        Picker("Event-day time zone", selection: Binding(
                            get: { model.preferences.timezone ?? TimeZone.current.identifier },
                            set: { value in Task { await save(timezone: value) } }
                        )) {
                            ForEach(timezoneOptions, id: \.self) { zone in
                                Text(zone.replacingOccurrences(of: "_", with: " ")).tag(zone)
                            }
                        }
                        .pickerStyle(.menu)
                        .disabled(model.isLoading)

                        Text("Event-day alerts arrive at 7:00 a.m. in this time zone. One-hour alerts follow each event’s time zone.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        if let availability = model.availability, !availability.available {
                            Label("iPhone push delivery is not configured on this server yet.", systemImage: "info.circle")
                                .font(.footnote)
                                .foregroundStyle(.orange)
                        } else if let availability = model.availability, !availability.scheduledDeliveryEnabled {
                            Label("The scheduled reminder service is not active yet. These choices are saved but alerts will not arrive.", systemImage: "info.circle")
                                .font(.footnote)
                                .foregroundStyle(.orange)
                        }

                        if let status = pushCoordinator.errorMessage ?? model.errorMessage {
                            Text(status)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .accessibilityIdentifier("native-settings-error")
                        }
                    }
                }

                Section {
                    Text("Turning off alerts here removes this iPhone’s notification registration. Your account preferences and other devices remain unchanged.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Account removal") {
                    Text("Review exactly what will be removed before confirming. Linked PWA accounts and their shared data are protected.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button(removalAccepted ? "Finish signing out" : "Delete account or remove iPhone access", role: .destructive) {
                        Task {
                            if removalAccepted { await finishRemoval() }
                            else { await reviewRemoval() }
                        }
                    }
                    .disabled(removalBusy)
                    .accessibilityIdentifier("native-settings-delete-account")
                    if removalBusy { ProgressView("Processing account removal") }
                    if removalAccepted {
                        Text("Your removal request was accepted. iPhone access is blocked now. Server cleanup will retry automatically if needed.")
                            .font(.footnote)
                    }
                    if let removalError {
                        Text(removalError)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("native-settings-delete-error")
                    }
                }
            }
            .disabled(removalBusy)
            .alert(item: $deletionPreview) { preview in
                Alert(
                    title: Text(preview.title),
                    message: Text(preview.explanation),
                    primaryButton: .destructive(Text(preview.actionTitle)) {
                        Task { await confirmRemoval(preview) }
                    },
                    secondaryButton: .cancel(Text("Keep my account"))
                )
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .disabled(removalBusy)
                }
            }
            .task {
                await model.load(clerk: clerk)
                await pushCoordinator.configure(clerk: clerk)
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, !removalBusy, !removalAccepted else { return }
                Task { await pushCoordinator.configure(clerk: clerk) }
            }
            .preferredColorScheme(.light)
            .interactiveDismissDisabled(removalBusy)
        }
    }

    private var availabilityIsUnavailable: Bool {
        model.isLoading || !model.isLinked || model.availability?.available != true
    }

    private func setDeviceAlerts(_ enabled: Bool) async {
        if enabled {
            _ = await pushCoordinator.enable(clerk: clerk)
        } else {
            _ = await pushCoordinator.disable(clerk: clerk)
        }
    }

    private func save(oneHourBefore: Bool? = nil, dayOf: Bool? = nil, timezone: String? = nil) async {
        let previous = model.preferences
        await model.save(
            oneHourBefore: oneHourBefore,
            dayOf: dayOf,
            timezone: timezone,
            clerk: clerk
        )
        if model.errorMessage != nil {
            model.preferences = previous
        }
    }

    private func signOut() async {
        guard await pushCoordinator.disable(clerk: clerk) else { return }
        do {
            try await clerk.auth.signOut()
            dismiss()
        } catch {
            pushCoordinator.errorMessage = "Could not sign out right now. Try again."
        }
    }

    private func reviewRemoval() async {
        removalBusy = true
        removalError = nil
        defer { removalBusy = false }
        do {
            let data = try await NativeAccountLinkClient().getData("account/deletion", clerk: clerk)
            let preview = try JSONDecoder().decode(NativeAccountDeletionPreview.self, from: data)
            if preview.status != "not_requested" {
                removalAccepted = true
                accountRemovalReceiptScope = preview.scope
                await finishRemoval()
            } else {
                deletionPreview = preview
            }
        } catch {
            removalError = error.localizedDescription
        }
    }

    private func confirmRemoval(_ preview: NativeAccountDeletionPreview) async {
        guard !removalBusy else { return }
        removalBusy = true
        removalError = nil
        defer { removalBusy = false }
        do {
            _ = try await NativeAccountLinkClient().postData(
                "account/deletion",
                body: NativeAccountDeletionBody(scope: preview.scope, target: preview.target),
                clerk: clerk
            )
            removalAccepted = true
            accountRemovalReceiptScope = preview.scope
            await finishRemoval()
        } catch {
            removalError = "Could not confirm removal. Review and retry; repeating an accepted request will not delete anything twice. \(error.localizedDescription)"
        }
    }

    private func finishRemoval() async {
        pushCoordinator.clearAfterAccountRemoval()
        do {
            try await clerk.auth.signOut()
            dismiss()
        } catch {
            removalError = "Your removal request was accepted, but this iPhone could not finish signing out. Tap Finish signing out to retry."
        }
    }
}
#endif
