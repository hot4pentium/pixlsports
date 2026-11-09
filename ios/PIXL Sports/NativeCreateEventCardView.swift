import SwiftUI
import ClerkKit

struct NativeCreateEventCardView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    let athleteName: String
    let teamName: String?
    let seasonName: String?
    let initialTimezone: String?
    let clerk: Clerk?
    let existingEvent: AthleteFanEvent?
    let shareToken: String?
    let pendingChange: NativePendingEventCardChange?
    let onCreated: (String) -> Void
    let onSavedLocally: (() -> Void)?

    @State private var eventType = "game"
    @State private var eventDate: Date
    @State private var eventTime: Date
    @State private var opponent = ""
    @State private var location = ""
    @State private var timezone: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var localSaveMessage: String?
    @State private var canRetrySave = false
    @State private var completedEventCallback = false
    @State private var eventID = UUID().uuidString.lowercased()
    @State private var fixtureIsOnline = false
    @State private var conflictFixtureRefresh = 0

    private let timeZoneChoices = [
        "America/New_York", "America/Chicago", "America/Denver",
        "America/Phoenix", "America/Los_Angeles", "America/Anchorage",
        "Pacific/Honolulu"
    ]

    init(
        athleteName: String,
        teamName: String?,
        seasonName: String?,
        initialTimezone: String?,
        clerk: Clerk?,
        existingEvent: AthleteFanEvent? = nil,
        shareToken: String? = nil,
        pendingChange: NativePendingEventCardChange? = nil,
        onCreated: @escaping (String) -> Void,
        onSavedLocally: (() -> Void)? = nil
    ) {
        self.athleteName = athleteName
        self.teamName = teamName
        self.seasonName = seasonName
        self.initialTimezone = initialTimezone
        self.clerk = clerk
        self.existingEvent = existingEvent
        self.shareToken = shareToken
        self.pendingChange = pendingChange
        self.onCreated = onCreated
        self.onSavedLocally = onSavedLocally
        let pendingDraft = pendingChange?.draft
        let zone = pendingDraft?.timezone ?? existingEvent?.timezone ?? initialTimezone ?? TimeZone.current.identifier
        _timezone = State(initialValue: zone)
        _eventType = State(initialValue: pendingDraft?.type ?? existingEvent?.type ?? "game")
        _eventDate = State(initialValue: Self.dateValue(
            pendingDraft?.date ?? existingEvent?.date,
            time: "12:00",
            timezone: zone
        ) ?? Self.defaultDate(timezone: zone))
        _eventTime = State(initialValue: Self.dateValue(
            pendingDraft?.date ?? existingEvent?.date,
            time: pendingDraft?.time ?? existingEvent?.time ?? "18:00",
            timezone: zone
        ) ?? Date())
        _opponent = State(initialValue: pendingDraft?.opponent ?? existingEvent?.opponent ?? "")
        _location = State(initialValue: pendingDraft?.location ?? existingEvent?.location ?? "")
        _eventID = State(initialValue: pendingDraft?.id ?? existingEvent?.eventId ?? UUID().uuidString.lowercased())
    }

    private var selectedTimeZone: TimeZone {
        TimeZone(identifier: timezone) ?? .current
    }

    private var availableTimeZones: [String] {
        Array(Set(timeZoneChoices + [TimeZone.current.identifier, initialTimezone ?? ""]))
            .filter { !$0.isEmpty }
            .sorted()
    }

    private var dateValue: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = selectedTimeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: eventDate)
    }

    private var timeValue: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = selectedTimeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: eventTime)
    }

    private var isEditing: Bool {
        pendingChange?.operation == .update || (existingEvent != nil && shareToken != nil)
    }

    private var canSaveWithoutClerk: Bool {
#if DEBUG
        NativeEventCardCreateRetryUITestFixture.isRequested
            || NativeEventCardConflictUITestFixture.isRequested
#else
        false
#endif
    }

    private var trimmedSeasonName: String? {
        guard let seasonName else { return nil }
        let trimmed = seasonName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var body: some View {
        let _ = conflictFixtureRefresh
        ZStack {
            NativePageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 7) {
                        SupporterEyebrow(
                            text: trimmedSeasonName.map { "SEASON · \($0)" } ?? "YOUR SEASON",
                            color: SupporterHomeColors.accentText
                        )
                        Text(isEditing ? "Edit Event Card" : "Create an Event Card")
                            .font(.largeTitle.weight(.black))
                            .fontDesign(.rounded)
                            .foregroundStyle(SupporterHomeColors.background)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(isEditing ? "Update the details for \(athleteName)’s event." : "Add the next event for \(athleteName).")
                            .font(.body)
                            .foregroundStyle(SupporterHomeColors.lightMuted)
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        Picker("Event type", selection: $eventType) {
                            Text("Game").tag("game")
                            Text("Practice").tag("practice")
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("native-event-type")

                        if eventType == "game" {
                            TextField(
                                "Opponent",
                                text: $opponent,
                                prompt: Text("Opponent").foregroundColor(.white.opacity(0.76))
                            )
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()
                                .padding(14)
                                .background(Color(red: 0.15, green: 0.27, blue: 0.42), in: RoundedRectangle(cornerRadius: 13))
                                .foregroundStyle(.white)
                                .tint(SupporterHomeColors.accent)
                                .accessibilityLabel("Opponent")
                                .accessibilityHint("Enter the opposing team.")
                                .accessibilityIdentifier("native-event-opponent")
                                .onChange(of: opponent) { _, value in
                                    if value.count > 200 { opponent = String(value.prefix(200)) }
                                }
                        }

                        DatePicker(
                            "Date",
                            selection: $eventDate,
                            displayedComponents: .date
                        )
                        .environment(\.timeZone, selectedTimeZone)
                        .tint(SupporterHomeColors.accent)
                        .accessibilityIdentifier("native-event-date")
                        DatePicker("Start time", selection: $eventTime, displayedComponents: .hourAndMinute)
                            .environment(\.timeZone, selectedTimeZone)
                            .tint(SupporterHomeColors.accent)
                            .accessibilityIdentifier("native-event-start-time")

                        Picker("Event time zone", selection: $timezone) {
                            ForEach(availableTimeZones, id: \.self) { zone in
                                Text(zone).tag(zone)
                            }
                        }
                        .tint(SupporterHomeColors.accent)
                        .accessibilityIdentifier("native-event-time-zone")
                        .onChange(of: timezone) { oldZone, newZone in
                            let selectedDate = Self.formatted(eventDate, pattern: "yyyy-MM-dd", timezone: oldZone)
                            let selectedTime = Self.formatted(eventTime, pattern: "HH:mm", timezone: oldZone)
                            eventDate = Self.dateValue(selectedDate, time: "12:00", timezone: newZone) ?? eventDate
                            eventTime = Self.dateValue(selectedDate, time: selectedTime, timezone: newZone) ?? eventTime
                        }

                        TextField(
                            "Location (optional)",
                            text: $location,
                            prompt: Text("Location (optional)").foregroundColor(.white.opacity(0.76))
                        )
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .padding(14)
                            .background(Color(red: 0.15, green: 0.27, blue: 0.42), in: RoundedRectangle(cornerRadius: 13))
                            .foregroundStyle(.white)
                            .tint(SupporterHomeColors.accent)
                            .accessibilityLabel("Location (optional)")
                            .accessibilityHint("Enter the event location, if known.")
                            .accessibilityIdentifier("native-event-location")
                            .onChange(of: location) { _, value in
                                if value.count > 300 { location = String(value.prefix(300)) }
                            }
                    }
                    .font(.body.weight(.medium))
                    .foregroundStyle(.white)
                    .environment(\.colorScheme, .dark)
                    .padding(18)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
                    .supporterSurfaceShadow()

#if DEBUG
                    if NativeEventCardCreateRetryUITestFixture.isRequested {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(fixtureIsOnline ? "PIXL connection: Reconnected" : "PIXL connection: Offline")
                                .accessibilityIdentifier("native-event-create-fixture-connection")
                            Button("Reconnect PIXL") {
                                NativeEventCardCreateRetryUITestFixture.setOnline(true)
                                fixtureIsOnline = true
                            }
                            .accessibilityIdentifier("native-event-create-fixture-reconnect")
                            Text("Pending Event Cards: \(NativeEventCardCreateRetryUITestFixture.savedDrafts.count)")
                                .accessibilityIdentifier("native-event-create-fixture-saved-count")
                            if let savedDraft = NativeEventCardCreateRetryUITestFixture.savedDrafts.values.first {
                                Text("Saved details: \(savedDraft.opponent) at \(savedDraft.location)")
                                    .accessibilityIdentifier("native-event-create-fixture-saved-details")
                            }
                            Text("Server Event Cards: \(NativeEventCardCreateRetryUITestFixture.serverDrafts.count)")
                                .accessibilityIdentifier("native-event-create-fixture-server-count")
                            Text("Confirmed Event Cards: \(NativeEventCardCreateRetryUITestFixture.confirmedEventIDs.count)")
                                .accessibilityIdentifier("native-event-create-fixture-confirmed-count")
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.lightMuted)
                    } else if NativeEventCardConflictUITestFixture.isRequested {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(NativeEventCardConflictUITestFixture.isOnline
                                 ? "PIXL connection: Reconnected"
                                 : "PIXL connection: Offline")
                                .accessibilityIdentifier("native-event-card-conflict-fixture-connection")
                            Button("Edit on another device") {
                                NativeEventCardConflictUITestFixture.editOnAnotherDevice()
                                conflictFixtureRefresh += 1
                            }
                            .accessibilityIdentifier("native-event-card-conflict-fixture-remote-edit")
                            Button("Reconnect PIXL") {
                                NativeEventCardConflictUITestFixture.reconnect()
                                conflictFixtureRefresh += 1
                            }
                            .accessibilityIdentifier("native-event-card-conflict-fixture-reconnect")
                            Text("Pending Event Cards: \(NativeEventCardConflictUITestFixture.pendingCardCount)")
                                .accessibilityIdentifier("native-event-card-conflict-fixture-pending-count")
                            Text("Server Event Cards: \(NativeEventCardConflictUITestFixture.serverCardCount)")
                                .accessibilityIdentifier("native-event-card-conflict-fixture-server-count")
                            Text("Server version: \(Self.conflictSummary(NativeEventCardConflictUITestFixture.serverDraft))")
                                .accessibilityIdentifier("native-event-card-conflict-fixture-server-details")
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.lightMuted)
                    }
#endif

#if DEBUG
                    if NativeEventCardConflictUITestFixture.isRequested,
                       let pendingChange = NativeEventCardConflictUITestFixture.pendingChange,
                       NativeEventCardConflictUITestFixture.isConflicted,
                       let serverDraft = pendingChange.conflictDraft {
                        NativeEventCardConflictPanel(
                            message: pendingChange.conflictMessage ?? "",
                            localDraft: pendingChange.draft,
                            serverDraft: serverDraft,
                            onKeepLocal: {
                                NativeEventCardConflictUITestFixture.keepLocalEdits()
                                localSaveMessage = "Your iPhone edits are now on the server."
                                canRetrySave = false
                                conflictFixtureRefresh += 1
                            },
                            onUseServer: {
                                NativeEventCardConflictUITestFixture.useServerVersion()
                                localSaveMessage = "The server version is kept on this iPhone."
                                canRetrySave = false
                                conflictFixtureRefresh += 1
                            }
                        )
                    }
#endif

                    Text("Event Cards sync to your PIXL account. If PIXL can’t be reached, this iPhone keeps a private draft until it can sync.")
                        .font(.footnote)
                        .foregroundStyle(SupporterHomeColors.lightMuted)

                    if let localSaveMessage {
                        Text(localSaveMessage)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(SupporterHomeColors.accentText)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("native-event-create-local-status")
                        if canRetrySave {
                            Button("Try syncing now") {
                                Task { await saveEventCard(forceNetworkAttempt: true) }
                            }
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(SupporterHomeColors.background)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("native-event-create-retry")
                        }
                    }

                    if let errorMessage {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(errorMessage)
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color(red: 0.58, green: 0.08, blue: 0.10))
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityLabel("Event Card save error: \(errorMessage)")
                                .accessibilityIdentifier("native-event-create-error")
                            if canRetrySave {
                                Button("Try again") {
                                    Task { await saveEventCard() }
                                }
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(SupporterHomeColors.background)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("native-event-create-retry")
                            }
                        }
                    }

                    Button {
                        Task { await saveEventCard() }
                    } label: {
                        HStack(spacing: 10) {
                            if isSaving {
                                ProgressView().tint(SupporterHomeColors.background)
                            } else {
                                Image(systemName: "plus").fontWeight(.black)
                            }
                            Text(isSaving ? "Saving…" : localSaveMessage != nil
                                 ? (offline.online ? "Try sync Event Card" : "Save changes on this iPhone")
                                 : isEditing ? "Save Changes" : "Create Event Card")
                                .font(.headline.weight(.black))
                        }
                        .foregroundStyle(SupporterHomeColors.background)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 17))
                    }
                    .disabled(isSaving || (clerk == nil && !canSaveWithoutClerk))
                    .opacity(!isSaving && (clerk != nil || canSaveWithoutClerk) ? 1 : 0.58)
                    .accessibilityIdentifier("native-event-create-submit")

                    if clerk == nil && !canSaveWithoutClerk {
                        Text("Sign in on this iPhone to create an Event Card.")
                            .font(.footnote)
                            .foregroundStyle(SupporterHomeColors.lightMuted)
                    }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle(isEditing ? "Edit Event Card" : "New Event Card")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("native-event-card-create")
        .onAppear {
            if let pendingChange {
                localSaveMessage = pendingChange.lastError
                    ?? "Saved on this iPhone. Waiting to sync with PIXL."
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeEventCardQueueSynced)) { _ in
            guard let clerk, let subject = clerk.user?.id,
                  localSaveMessage != nil,
                  !completedEventCallback,
                  !offline.pendingEventCards(subject: subject).contains(where: { $0.id == eventID }) else { return }
            if let token = offline.recentlySyncedEventCardToken(id: eventID, subject: subject) {
                completeSync(token: token)
                return
            }
            Task {
                guard let schedule = try? await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk),
                      let event = schedule.events.first(where: { $0.eventId == eventID }) else { return }
                completeSync(token: event.shareToken)
            }
        }
    }

    @MainActor
    private func saveEventCard(forceNetworkAttempt: Bool = false) async {
        guard clerk != nil || canSaveWithoutClerk else {
            errorMessage = "Sign in on this iPhone to manage Event Cards."
            return
        }
        let cleanOpponent = opponent.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
        guard eventType == "practice" || !cleanOpponent.isEmpty else {
            errorMessage = "Enter an opponent for a game."
            return
        }
        guard TimeZone(identifier: timezone) != nil else {
            errorMessage = "Choose a valid event time zone."
            return
        }
        guard cleanOpponent.count <= 200, cleanLocation.count <= 300 else {
            errorMessage = "The opponent or location is too long."
            return
        }
        isSaving = true
        errorMessage = nil
        localSaveMessage = nil
        canRetrySave = false
        defer { isSaving = false }

        let draft = NativeEventCardDraft(
            id: eventID,
            type: eventType,
            date: dateValue,
            time: timeValue,
            timezone: timezone,
            location: cleanLocation,
            opponent: eventType == "practice" ? "" : cleanOpponent
        )
#if DEBUG
        if canSaveWithoutClerk {
            if NativeEventCardConflictUITestFixture.isRequested {
                if forceNetworkAttempt {
                    NativeEventCardConflictUITestFixture.retrySync()
                    if NativeEventCardConflictUITestFixture.isConflicted {
                        localSaveMessage = nil
                        canRetrySave = false
                    } else if NativeEventCardConflictUITestFixture.pendingCardCount == 0 {
                        localSaveMessage = "Event Card synced. One server card remains."
                        canRetrySave = false
                    }
                    conflictFixtureRefresh += 1
                    return
                }
                NativeEventCardConflictUITestFixture.saveOffline(draft)
                localSaveMessage = "Saved on this iPhone. Waiting for a connection to PIXL."
                canRetrySave = true
                return
            }
            NativeEventCardCreateRetryUITestFixture.saveLocally(draft)
            localSaveMessage = "Saved on this iPhone. Waiting to sync with PIXL."
            guard NativeEventCardCreateRetryUITestFixture.isOnline else {
                canRetrySave = true
                return
            }
            do {
                let token = try NativeEventCardCreateRetryUITestFixture.create(draft)
                try NativeEventCardCreateRetryUITestFixture.confirm(token: token, draft: draft)
                localSaveMessage = nil
                onCreated(token)
            } catch {
                localSaveMessage = "Saved on this iPhone. PIXL could not confirm the save yet."
                canRetrySave = true
            }
            return
        }
#endif
        guard let clerk, let subject = clerk.user?.id else {
            errorMessage = "Sign in on this iPhone before saving an Event Card draft."
            return
        }
        let runtime = NativeOfflineRuntime.shared
        let queuedChange = runtime.pendingEventCards(subject: subject).first(where: { $0.id == draft.id })
        let operation = queuedChange?.operation ?? pendingChange?.operation ?? (isEditing ? .update : .create)
        let baseline = queuedChange?.baseDraft ?? pendingChange?.baseDraft ?? existingEvent.map(NativeEventCardDraft.from)
        var change = queuedChange ?? pendingChange ?? NativePendingEventCardChange(
            operation: operation,
            draft: draft,
            teamName: teamName,
            athleteName: athleteName,
            seasonName: trimmedSeasonName,
            shareToken: shareToken,
            baseDraft: baseline,
            attemptedDraft: nil,
            conflictDraft: nil,
            conflictMessage: nil,
            lastError: nil,
            createdAt: Date()
        )
        guard change.operation != .delete else {
            errorMessage = "This Event Card is queued for deletion and can’t be edited."
            return
        }
        guard !change.isConflicted else {
            errorMessage = change.conflictMessage ?? "Review this Event Card’s saved changes before editing it again."
            return
        }
        change.draft = draft
        change.lastError = nil
        var persistedLocally = false
        do {
            try runtime.savePendingEventCard(change, subject: subject)
            persistedLocally = true
            if let onSavedLocally {
                // The protected local write completes the user's save. Do not
                // hold the editor open or navigate again after cloud recovery.
                completedEventCallback = true
                onSavedLocally()
                if runtime.online || forceNetworkAttempt {
                    // This unstructured task survives the editor's dismissal.
                    // The runtime rechecks account ownership and keeps failures
                    // in the durable queue for later retries.
                    Task {
                        _ = await runtime.retryPendingEventCards(clerk: clerk, onlyID: draft.id)
                    }
                }
                return
            }
            localSaveMessage = "Saved on this iPhone. Checking PIXL sync…"
            let syncedTokens: [String: String]
            if runtime.online || forceNetworkAttempt {
                syncedTokens = await runtime.retryPendingEventCards(clerk: clerk, onlyID: draft.id)
            } else {
                syncedTokens = [:]
            }
            if let remaining = runtime.pendingEventCards(subject: subject).first(where: { $0.id == draft.id }) {
                localSaveMessage = remaining.lastError
                    ?? (runtime.online
                        ? "Saved on this iPhone. Waiting to sync with PIXL."
                        : "Saved on this iPhone. Waiting for a connection to PIXL.")
                canRetrySave = true
            } else if !runtime.vault.canContinue(subject: subject) {
                localSaveMessage = "Reconnect your PIXL account to check this saved Event Card."
                canRetrySave = true
            } else if let token = syncedTokens[draft.id]
                        ?? runtime.recentlySyncedEventCardToken(id: draft.id, subject: subject)
                        ?? change.shareToken
                        ?? pendingChange?.shareToken {
                completeSync(token: token)
            } else {
                // The queue may have been cleared after a successful create.
                // Read the refreshed schedule to obtain its server-issued token.
                let schedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
                guard let event = schedule.events.first(where: { $0.eventId == draft.id }) else {
                    throw SupporterHomeAPIError.eventSaveNotConfirmed
                }
                completeSync(token: event.shareToken)
            }
        } catch {
            if persistedLocally {
                localSaveMessage = runtime.vault.canContinue(subject: subject)
                    ? "Saved on this iPhone. PIXL sync will retry when you try again."
                    : "Reconnect your PIXL account to check this saved Event Card."
            } else {
                errorMessage = "This Event Card could not be saved on this iPhone. Check the saved-work status and try again."
            }
            canRetrySave = true
        }
    }

    @MainActor
    private func completeSync(token: String) {
        guard !completedEventCallback else { return }
        completedEventCallback = true
        localSaveMessage = nil
        onCreated(token)
        if isEditing { dismiss() }
    }

    private static func conflictSummary(_ draft: NativeEventCardDraft) -> String {
        let event = draft.type == "practice" ? "Practice" : "Game vs. \(draft.opponent)"
        let location = draft.location.isEmpty ? "Location not set" : draft.location
        return "\(event) · \(draft.date) at \(draft.time) · \(location)"
    }

    private static func dateValue(_ date: String?, time: String, timezone: String) -> Date? {
        guard let date else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone) ?? .current
        formatter.isLenient = false
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: "\(date) \(time)")
    }

    private static func formatted(_ date: Date, pattern: String, timezone: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone) ?? .current
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    private static func defaultDate(timezone: String) -> Date {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        return dateValue(today, time: "12:00", timezone: timezone)
            .flatMap { calendar.date(byAdding: .day, value: 1, to: $0) }
            ?? Date()
    }
}

struct NativeEventCardConflictPanel: View {
    let message: String
    let localDraft: NativeEventCardDraft
    let serverDraft: NativeEventCardDraft
    let onKeepLocal: () -> Void
    let onUseServer: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(message)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)

            Text("Your iPhone edits")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
            Text(Self.summary(localDraft))
                .font(.footnote)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("native-event-card-conflict-local-version")

            Text("Current server version")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
            Text(Self.summary(serverDraft))
                .font(.footnote)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("native-event-card-conflict-server-version")

            Button("Keep my iPhone edits", action: onKeepLocal)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(SupporterHomeColors.accent)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .accessibilityIdentifier("native-event-card-conflict-keep-local")
            Button("Use server version", action: onUseServer)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white.opacity(0.8))
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .accessibilityIdentifier("native-event-card-conflict-use-server")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityIdentifier("native-event-card-conflict-panel")
    }

    private static func summary(_ draft: NativeEventCardDraft) -> String {
        let event = draft.type == "practice" ? "Practice" : "Game vs. \(draft.opponent)"
        let location = draft.location.isEmpty ? "Location not set" : draft.location
        return "\(event) · \(draft.date) at \(draft.time) · \(location)"
    }
}
