import SwiftUI
import ClerkKit

struct NativeAthleteProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var offline = NativeOfflineRuntime.shared

    let clerk: Clerk
    var isInitialSetup = false
    var initialProfile: NativeSupporterProfile? = nil
    var onSaved: ((NativeSupporterProfile) -> Void)? = nil

    @State private var athleteName = ""
    @State private var teamName = ""
    @State private var jerseyNumber = ""
    @State private var position = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var didSave = false
    @State private var loadError: String?
    @State private var saveError: String?
    @State private var savedProfile: NativeSupporterProfile?
    @State private var pendingChange: NativePendingAthleteProfileChange?
    @State private var sport: String?
    @State private var setupTimezone = TimeZone.current.identifier
    @State private var profileSubject: String?
    @State private var profileNamespace: String?

    private var accountIsCurrent: Bool {
        guard let profileSubject, clerk.user?.id == profileSubject else { return false }
        if isInitialSetup { return true }
        return profileNamespace == offline.vault.namespace
            && offline.vault.canContinue(subject: profileSubject)
    }

    private var editedProfile: NativeSupporterProfile {
        NativeSupporterProfile(
            athleteName: athleteName.trimmingCharacters(in: .whitespacesAndNewlines),
            teamName: teamName.trimmingCharacters(in: .whitespacesAndNewlines),
            jerseyNumber: jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            position: position.trimmingCharacters(in: .whitespacesAndNewlines),
            sport: sport,
            requiresSetup: savedProfile?.requiresSetup
        )
    }

    private var canSave: Bool {
        !isLoading
            && !isSaving
            && pendingChange?.isConflicted != true
            && (isInitialSetup || accountIsCurrent)
            && !athleteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        Form {
            if let profileSubject, !accountIsCurrent {
                Section {
                    Text("This profile is no longer available for the signed-in account. Close and reopen it to continue.")
                        .accessibilityIdentifier("native-athlete-profile-account-changed")
                }
            } else if isLoading {
                Section {
                    ProgressView("Loading athlete profile")
                        .accessibilityIdentifier("native-athlete-profile-loading")
                }
            } else if let loadError {
                Section {
                    Text(loadError)
                        .foregroundStyle(.red)
                    Button("Try again") {
                        Task { await loadProfile() }
                    }
                    .accessibilityIdentifier("native-athlete-profile-retry")
                }
            } else {
                if isInitialSetup, savedProfile?.requiresSetup == true,
                   !athleteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Section {
                        Text("Your athlete details were saved, but setup still needs to finish. Review them and tap Continue to finish your private HYPE Card setup. Any existing card will be kept.")
                            .accessibilityIdentifier("native-athlete-profile-resume")
                    }
                }
                Section("Athlete information") {
                    if isInitialSetup {
                        Picker("Sport", selection: Binding(
                            get: { sport ?? "soccer" },
                            set: { sport = $0 }
                        )) {
                            Text("Soccer").tag("soccer")
                            Text("Basketball").tag("basketball")
                            Text("Volleyball").tag("volleyball")
                            Text("Football").tag("football")
                            Text("Baseball").tag("baseball")
                            Text("Softball").tag("softball")
                        }
                        .accessibilityIdentifier("native-athlete-profile-sport")
                    }
                    TextField("Athlete name", text: $athleteName)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Athlete name, required")
                        .accessibilityIdentifier("native-athlete-profile-name")
                        .onChange(of: athleteName) { _, value in
                            if value.count > 100 { athleteName = String(value.prefix(100)) }
                        }

                    TextField("Team name", text: $teamName)
                        .textInputAutocapitalization(.words)
                        .accessibilityLabel("Team name, optional")
                        .accessibilityIdentifier("native-athlete-profile-team")
                        .onChange(of: teamName) { _, value in
                            if value.count > 160 { teamName = String(value.prefix(160)) }
                        }

                    TextField("Jersey number", text: $jerseyNumber)
                        .keyboardType(.numbersAndPunctuation)
                        .accessibilityLabel("Jersey number, optional")
                        .accessibilityIdentifier("native-athlete-profile-jersey")
                        .onChange(of: jerseyNumber) { _, value in
                            if value.count > 40 { jerseyNumber = String(value.prefix(40)) }
                        }

                    TextField("Position", text: $position)
                        .textInputAutocapitalization(.words)
                        .accessibilityLabel("Position, optional")
                        .accessibilityIdentifier("native-athlete-profile-position")
                        .onChange(of: position) { _, value in
                            if value.count > 100 { position = String(value.prefix(100)) }
                        }
                }

                if let pendingChange, pendingChange.isConflicted {
                    Section("Profile changes need review") {
                        Text(pendingChange.conflictMessage
                             ?? "The saved PIXL profile changed while your iPhone edits were waiting.")
                            .font(.footnote)
                            .accessibilityIdentifier("native-athlete-profile-conflict")
                        Text("On this iPhone: \(profileVersionDescription(pendingChange.desired))")
                            .font(.footnote)
                            .accessibilityIdentifier("native-athlete-profile-local-version")
                        if let remote = pendingChange.conflictProfile {
                            Text("Saved on PIXL: \(profileVersionDescription(remote))")
                                .font(.footnote)
                                .accessibilityIdentifier("native-athlete-profile-server-version")
                            Button("Keep iPhone edits") {
                                Task { await resolveConflict(keepIPhoneVersion: true) }
                            }
                            .disabled(isSaving || !accountIsCurrent)
                            .accessibilityIdentifier("native-athlete-profile-keep-local")
                            Button("Use PIXL version", role: .destructive) {
                                Task { await resolveConflict(keepIPhoneVersion: false) }
                            }
                            .disabled(isSaving || !accountIsCurrent)
                            .accessibilityIdentifier("native-athlete-profile-use-server")
                        }
                    }
                } else if pendingChange != nil {
                    Section {
                        if let lastError = pendingChange?.lastError {
                            Label(lastError, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .accessibilityIdentifier("native-athlete-profile-pending")
                        } else {
                            Label(
                                offline.online
                                    ? "Saved on this iPhone. Waiting for PIXL to confirm the linked account before syncing."
                                    : "Saved on this iPhone. It will sync after you reconnect and PIXL confirms the linked account.",
                                systemImage: offline.online ? "arrow.triangle.2.circlepath" : "wifi.slash"
                            )
                            .font(.footnote)
                            .accessibilityIdentifier("native-athlete-profile-pending")
                        }
                    }
                }

                if isInitialSetup {
                    Section("Time zone") {
                        Picker("Your time zone", selection: $setupTimezone) {
                            ForEach(Array(Set(TimeZone.knownTimeZoneIdentifiers + [setupTimezone])).sorted(), id: \.self) { zone in
                                Text(zone.replacingOccurrences(of: "_", with: " ")).tag(zone)
                            }
                        }
                        .accessibilityIdentifier("native-athlete-profile-timezone")
                        Text("Detected from your iPhone. You can choose a different time zone for each event.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                if !isInitialSetup {
                    NativeAthletePhotoSection(clerk: clerk, profileIsSaved: savedProfile == editedProfile)
                        .id(clerk.user?.id)
                }

                Section {
                    Text(isInitialSetup
                        ? "Setup gives your athlete a private starter HYPE Card. If you already have a card, we keep its athlete, team, sport, and season. Add a photo later in Settings. Nothing is published until you choose to share."
                        : "These details are saved to your iPhone account and can be edited later in Settings. Saving your profile does not publish a private HYPE Card.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if let saveError {
                    Section {
                        Text(saveError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("native-athlete-profile-error")
                    }
                }
            }
        }
        .navigationTitle(isInitialSetup ? "Athlete setup" : "Athlete profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await saveProfile() }
                } label: {
                    Group {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text(isInitialSetup ? "Continue" : "Save")
                        }
                    }
                    .nativeToolbarLabel()
                }
                .disabled(!canSave)
                .accessibilityIdentifier("native-athlete-profile-save")
            }
        }
        .interactiveDismissDisabled(isInitialSetup && !didSave)
        .task {
            if isInitialSetup, let initialProfile {
                guard let subject = clerk.user?.id else {
                    loadError = "Sign in to the iPhone app again before opening your athlete profile."
                    isLoading = false
                    return
                }
                profileSubject = subject
                profileNamespace = offline.vault.namespace
                do {
                    pendingChange = nil
                    let working = pendingChange?.desired ?? initialProfile
                    savedProfile = working
                    sport = working.sport
                    athleteName = working.athleteName
                    teamName = working.teamName
                    jerseyNumber = working.jerseyNumber
                    position = working.position
                    isLoading = false
                } catch {
                    loadError = "A saved profile change could not be read. It has not been removed."
                    isLoading = false
                }
            } else {
                await loadProfile()
            }
        }
        .onChange(of: clerk.user?.id) { _, _ in
            clearLoadedProfile()
            Task { await loadProfile() }
        }
        .onChange(of: offline.accessGeneration) { _, _ in
            if profileNamespace != offline.vault.namespace {
                clearLoadedProfile()
                Task { await loadProfile() }
            }
        }
    }

    @MainActor
    private func loadProfile() async {
        isLoading = true
        loadError = nil
        saveError = nil
        let requestedSubject = clerk.user?.id
        let requestedNamespace = offline.vault.namespace
        guard let requestedSubject,
              isInitialSetup || offline.vault.canContinue(subject: requestedSubject) else {
            loadError = "Sign in and reconnect your linked athlete profile to continue."
            isLoading = false
            return
        }
        profileSubject = requestedSubject
        profileNamespace = requestedNamespace
        do {
            let profile = try await SupporterHomeAPI.fetchAthleteProfile(clerk: clerk)
            guard clerk.user?.id == requestedSubject,
                  offline.vault.namespace == requestedNamespace else {
                isLoading = false
                return
            }
            let pending = isInitialSetup
                ? nil
                : try NativeAccountLinkClient().pendingAthleteProfileChange(subject: requestedSubject)
            pendingChange = pending
            let working = pending?.desired ?? profile
            savedProfile = working
            sport = working.sport
            athleteName = working.athleteName
            teamName = working.teamName
            jerseyNumber = working.jerseyNumber
            position = working.position
            isLoading = false
        } catch {
            loadError = "We couldn’t load your athlete profile. Check your connection and try again."
            isLoading = false
        }
    }

    @MainActor
    private func saveProfile() async {
        guard canSave, accountIsCurrent else { return }
        isSaving = true
        saveError = nil
        guard let subject = clerk.user?.id else {
            saveError = "Sign in to the iPhone app again before saving."
            isSaving = false
            return
        }
        let requestNamespace = offline.vault.namespace
        let profile = NativeSupporterProfile(
            athleteName: athleteName.trimmingCharacters(in: .whitespacesAndNewlines),
            teamName: teamName.trimmingCharacters(in: .whitespacesAndNewlines),
            jerseyNumber: jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            position: position.trimmingCharacters(in: .whitespacesAndNewlines),
            sport: isInitialSetup ? (sport ?? "soccer") : sport
        )
        do {
            let saved = try await SupporterHomeAPI.saveAthleteProfile(
                profile,
                completeSetup: isInitialSetup,
                baseProfile: pendingChange?.base ?? savedProfile,
                setupTimezone: isInitialSetup ? setupTimezone : nil,
                clerk: clerk
            )
            guard clerk.user?.id == subject,
                  isInitialSetup || offline.vault.namespace == requestNamespace else {
                isSaving = false
                return
            }
            isSaving = false
            didSave = true
            savedProfile = saved
            if !isInitialSetup {
                pendingChange = try NativeAccountLinkClient().pendingAthleteProfileChange(subject: subject)
            }
            onSaved?(saved)
            if pendingChange?.isConflicted == true { return }
            dismiss()
        } catch {
            saveError = "We couldn’t save your athlete profile. Please try again."
            isSaving = false
        }
    }

    @MainActor
    private func resolveConflict(keepIPhoneVersion: Bool) async {
        guard !isSaving, accountIsCurrent else { return }
        isSaving = true
        saveError = nil
        do {
            let resolved = try await SupporterHomeAPI.resolveQueuedAthleteProfileConflict(
                keepIPhoneVersion: keepIPhoneVersion, clerk: clerk
            )
            guard accountIsCurrent else { isSaving = false; return }
            savedProfile = resolved
            athleteName = resolved.athleteName
            teamName = resolved.teamName
            jerseyNumber = resolved.jerseyNumber
            sport = resolved.sport
            position = resolved.position
            if let subject = profileSubject {
                pendingChange = try NativeAccountLinkClient().pendingAthleteProfileChange(subject: subject)
            }
            onSaved?(resolved)
            if pendingChange == nil { dismiss() }
            else if pendingChange?.isConflicted == false { dismiss() }
        } catch {
            saveError = "We couldn’t resolve the profile changes. Your saved iPhone edits are still here."
        }
        isSaving = false
    }

    private func clearLoadedProfile() {
        athleteName = ""
        teamName = ""
        jerseyNumber = ""
        position = ""
        sport = nil
        savedProfile = nil
        pendingChange = nil
        profileSubject = nil
        profileNamespace = nil
        isLoading = true
        loadError = nil
        saveError = nil
    }

    private func profileVersionDescription(_ profile: NativeSupporterProfile) -> String {
        [
            profile.athleteName,
            profile.teamName.isEmpty ? nil : profile.teamName,
            profile.jerseyNumber.isEmpty ? nil : "#\(profile.jerseyNumber)",
            profile.position.isEmpty ? nil : profile.position
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }
}
