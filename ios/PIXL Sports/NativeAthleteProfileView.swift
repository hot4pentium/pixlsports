import SwiftUI
import ClerkKit

struct NativeAthleteProfileView: View {
    @Environment(\.dismiss) private var dismiss

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
    @State private var sport: String?

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
            && !athleteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        Form {
            if isLoading {
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
                    if isSaving {
                        ProgressView()
                    } else {
                        Text(isInitialSetup ? "Continue" : "Save")
                    }
                }
                .disabled(!canSave)
                .accessibilityIdentifier("native-athlete-profile-save")
            }
        }
        .interactiveDismissDisabled(isInitialSetup && !didSave)
        .task {
            if let initialProfile {
                savedProfile = initialProfile
                sport = initialProfile.sport
                athleteName = initialProfile.athleteName
                teamName = initialProfile.teamName
                jerseyNumber = initialProfile.jerseyNumber
                position = initialProfile.position
                isLoading = false
            } else {
                await loadProfile()
            }
        }
    }

    @MainActor
    private func loadProfile() async {
        isLoading = true
        loadError = nil
        saveError = nil
        do {
            let profile = try await SupporterHomeAPI.fetchAthleteProfile(clerk: clerk)
            savedProfile = profile
            sport = profile.sport
            athleteName = profile.athleteName
            teamName = profile.teamName
            jerseyNumber = profile.jerseyNumber
            position = profile.position
            isLoading = false
        } catch {
            loadError = "We couldn’t load your athlete profile. Check your connection and try again."
            isLoading = false
        }
    }

    @MainActor
    private func saveProfile() async {
        guard canSave else { return }
        isSaving = true
        saveError = nil
        let profile = NativeSupporterProfile(
            athleteName: athleteName.trimmingCharacters(in: .whitespacesAndNewlines),
            teamName: teamName.trimmingCharacters(in: .whitespacesAndNewlines),
            jerseyNumber: jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            position: position.trimmingCharacters(in: .whitespacesAndNewlines),
            sport: isInitialSetup ? (sport ?? "soccer") : sport
        )
        do {
            let saved = try await SupporterHomeAPI.saveAthleteProfile(
                profile, completeSetup: isInitialSetup, clerk: clerk
            )
            isSaving = false
            didSave = true
            onSaved?(saved)
            dismiss()
        } catch {
            saveError = "We couldn’t save your athlete profile. Please try again."
            isSaving = false
        }
    }
}
