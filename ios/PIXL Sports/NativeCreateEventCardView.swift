import SwiftUI
import ClerkKit

struct NativeCreateEventCardView: View {
    @Environment(\.dismiss) private var dismiss
    let athleteName: String
    let teamName: String?
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
    @State private var eventID = UUID().uuidString.lowercased()

    private let timeZoneChoices = [
        "America/New_York", "America/Chicago", "America/Denver",
        "America/Phoenix", "America/Los_Angeles", "America/Anchorage",
        "Pacific/Honolulu"
    ]

    init(
        athleteName: String,
        teamName: String?,
        initialTimezone: String?,
        clerk: Clerk?,
        existingEvent: AthleteFanEvent? = nil,
        shareToken: String? = nil,
        onCreated: @escaping (String) -> Void
    ) {
        self.athleteName = athleteName
        self.teamName = teamName
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

    var body: some View {
        ZStack {
            NativePageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 7) {
                        SupporterEyebrow(text: "YOUR SEASON", color: SupporterHomeColors.accentText)
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
                        .tint(SupporterHomeColors.accentText)
                        .accessibilityIdentifier("native-event-date")
                        DatePicker("Start time", selection: $eventTime, displayedComponents: .hourAndMinute)
                            .environment(\.timeZone, selectedTimeZone)
                            .tint(SupporterHomeColors.accentText)
                            .accessibilityIdentifier("native-event-start-time")

                        Picker("Event time zone", selection: $timezone) {
                            ForEach(availableTimeZones, id: \.self) { zone in
                                Text(zone).tag(zone)
                            }
                        }
                        .tint(SupporterHomeColors.accentText)
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
                    .padding(18)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
                    .supporterSurfaceShadow()

                    Text(isEditing
                         ? "Changes are saved to the Event Card on the schedule connected to your PIXL account."
                         : "This adds an Event Card to the schedule connected to your PIXL account.")
                        .font(.footnote)
                        .foregroundStyle(SupporterHomeColors.lightMuted)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color(red: 0.58, green: 0.08, blue: 0.10))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel("Event Card save error: \(errorMessage)")
                            .accessibilityIdentifier("native-event-create-error")
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
                    .disabled(isSaving || clerk == nil)
                    .opacity(!isSaving && clerk != nil ? 1 : 0.58)
                    .accessibilityIdentifier("native-event-create-submit")

                    if clerk == nil {
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
        guard let clerk else {
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
            if let shareToken, isEditing {
                token = try await SupporterHomeAPI.updateEventCard(
                    shareToken: shareToken,
                    draft: draft,
                    clerk: clerk
                )
            } else {
                token = try await SupporterHomeAPI.createEventCard(
                    draft: draft,
                    teamName: teamName,
                    clerk: clerk
                )
            }
            try await SupporterHomeAPI.confirmEventCard(
                shareToken: token,
                draft: draft,
                clerk: clerk
            )
            onCreated(token)
            if isEditing { dismiss() }
        } catch {
            errorMessage = error.localizedDescription
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
