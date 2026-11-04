import SwiftUI
import ClerkKit

struct NativeCreateEventCardView: View {
    @Environment(\.dismiss) private var dismiss
    let athleteName: String
    let teamName: String?
    let seasonName: String?
    let initialTimezone: String?
    let clerk: Clerk?
    let existingEvent: AthleteFanEvent?
    let shareToken: String?
    let onCreated: (String) -> Void

    @State private var eventType = "game"
    @State private var eventDate: Date
    @State private var eventTime: Date
    @State private var opponent = ""
    @State private var location = ""
    @State private var timezone: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var canRetrySave = false
    @State private var eventID = UUID().uuidString.lowercased()
    @State private var fixtureIsOnline = false

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
        onCreated: @escaping (String) -> Void
    ) {
        self.athleteName = athleteName
        self.teamName = teamName
        self.seasonName = seasonName
        self.initialTimezone = initialTimezone
        self.clerk = clerk
        self.existingEvent = existingEvent
        self.shareToken = shareToken
        self.onCreated = onCreated
        let zone = existingEvent?.timezone ?? initialTimezone ?? TimeZone.current.identifier
        _timezone = State(initialValue: zone)
        _eventType = State(initialValue: existingEvent?.type ?? "game")
        _eventDate = State(initialValue: Self.dateValue(existingEvent?.date, time: "12:00", timezone: zone) ?? Self.defaultDate(timezone: zone))
        _eventTime = State(initialValue: Self.dateValue(existingEvent?.date, time: existingEvent?.time ?? "18:00", timezone: zone) ?? Date())
        _opponent = State(initialValue: existingEvent?.opponent ?? "")
        _location = State(initialValue: existingEvent?.location ?? "")
        _eventID = State(initialValue: existingEvent?.eventId ?? UUID().uuidString.lowercased())
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

    private var isEditing: Bool { existingEvent != nil && shareToken != nil }

    private var canSaveWithoutClerk: Bool {
#if DEBUG
        NativeEventCardCreateRetryUITestFixture.isRequested
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
                            Text("Saved Event Cards: \(NativeEventCardCreateRetryUITestFixture.savedDrafts.count)")
                                .accessibilityIdentifier("native-event-create-fixture-saved-count")
                            if let savedDraft = NativeEventCardCreateRetryUITestFixture.savedDrafts.values.first {
                                Text("Saved details: \(savedDraft.opponent) at \(savedDraft.location)")
                                    .accessibilityIdentifier("native-event-create-fixture-saved-details")
                            }
                            Text("Confirmed Event Cards: \(NativeEventCardCreateRetryUITestFixture.confirmedEventIDs.count)")
                                .accessibilityIdentifier("native-event-create-fixture-confirmed-count")
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.lightMuted)
                    }
#endif

                    Text(isEditing
                         ? "Updating an Event Card needs a connection to PIXL. Changes save to your PIXL account."
                         : "Creating an Event Card needs a connection to PIXL. It saves to your PIXL account, not on this iPhone.")
                        .font(.footnote)
                        .foregroundStyle(SupporterHomeColors.lightMuted)

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
                            Text(isSaving ? "Saving…" : isEditing ? "Save Changes" : "Create Event Card")
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
    }

    @MainActor
    private func saveEventCard() async {
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
        do {
            let token: String
            if canSaveWithoutClerk {
                token = try await SupporterHomeAPI.createEventCard(
                    draft: draft,
                    teamName: teamName,
                    athleteName: athleteName,
                    seasonName: trimmedSeasonName,
                    clerk: clerk
                )
            } else if let shareToken, isEditing, let clerk {
                token = try await SupporterHomeAPI.updateEventCard(
                    shareToken: shareToken,
                    draft: draft,
                    clerk: clerk
                )
            } else if let clerk {
                token = try await SupporterHomeAPI.createEventCard(
                    draft: draft,
                    teamName: teamName,
                    athleteName: athleteName,
                    seasonName: trimmedSeasonName,
                    clerk: clerk
                )
            } else {
                throw SupporterHomeAPIError.invalidResponse
            }
            try await SupporterHomeAPI.confirmEventCard(
                shareToken: token,
                draft: draft,
                clerk: clerk
            )
            onCreated(token)
            if isEditing { dismiss() }
        } catch {
            if let offlineError = error as? NativeOfflineError, offlineError == .onlineOnly {
                errorMessage = isEditing
                    ? "A connection to PIXL is required to update this Event Card. Your changes haven’t been saved."
                    : "A connection to PIXL is required to create this Event Card. It hasn’t been saved yet."
            } else {
                errorMessage = isEditing
                    ? "We couldn’t confirm that this Event Card was updated. Check your connection and try again."
                    : "We couldn’t confirm that this Event Card was saved. Check your connection and try again."
            }
            canRetrySave = true
        }
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
