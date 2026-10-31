import SwiftUI
import ClerkKit

struct NativeCreateEventCardView: View {
    let athleteName: String
    let teamName: String?
    let initialTimezone: String?
    let clerk: Clerk?
    let onCreated: (String) -> Void

    @State private var eventType = "game"
    @State private var eventDate = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var eventTime = Date()
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
        onCreated: @escaping (String) -> Void
    ) {
        self.athleteName = athleteName
        self.teamName = teamName
        self.initialTimezone = initialTimezone
        self.clerk = clerk
        self.onCreated = onCreated
        _timezone = State(initialValue: initialTimezone ?? TimeZone.current.identifier)
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

    private var canSave: Bool {
        !isSaving && (eventType == "practice" || !opponent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var body: some View {
        ZStack {
            SupporterHomeColors.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 7) {
                        SupporterEyebrow(text: "YOUR SEASON")
                        Text("Create an Event Card")
                            .font(.largeTitle.weight(.black))
                            .fontDesign(.rounded)
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Add the next event for \(athleteName).")
                            .font(.body)
                            .foregroundStyle(SupporterHomeColors.muted)
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        Picker("Event type", selection: $eventType) {
                            Text("Game").tag("game")
                            Text("Practice").tag("practice")
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("native-event-type")

                        if eventType == "game" {
                            TextField("Opponent", text: $opponent)
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()
                                .padding(14)
                                .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 13))
                                .accessibilityIdentifier("native-event-opponent")
                        }

                        DatePicker(
                            "Date",
                            selection: $eventDate,
                            in: Date()...,
                            displayedComponents: .date
                        )
                        .environment(\.timeZone, selectedTimeZone)
                        .tint(SupporterHomeColors.accent)

                        DatePicker("Start time", selection: $eventTime, displayedComponents: .hourAndMinute)
                            .environment(\.timeZone, selectedTimeZone)
                            .tint(SupporterHomeColors.accent)

                        Picker("Event time zone", selection: $timezone) {
                            ForEach(availableTimeZones, id: \.self) { zone in
                                Text(zone).tag(zone)
                            }
                        }
                        .tint(SupporterHomeColors.accent)

                        TextField("Location (optional)", text: $location)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .padding(14)
                            .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 13))
                            .accessibilityIdentifier("native-event-location")
                    }
                    .font(.body.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(18)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))

                    Text("This adds an Event Card to the schedule connected to your PIXL account.")
                        .font(.footnote)
                        .foregroundStyle(SupporterHomeColors.muted)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.red.opacity(0.9))
                            .fixedSize(horizontal: false, vertical: true)
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
                            Text(isSaving ? "Creating…" : "Create Event Card")
                                .font(.headline.weight(.black))
                        }
                        .foregroundStyle(SupporterHomeColors.background)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 17))
                    }
                    .disabled(!canSave || clerk == nil)
                    .opacity(canSave && clerk != nil ? 1 : 0.58)
                    .accessibilityIdentifier("native-event-create-submit")

                    if clerk == nil {
                        Text("Sign in on this iPhone to create an Event Card.")
                            .font(.footnote)
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle("New Event Card")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("native-event-card-create")
    }

    @MainActor
    private func saveEventCard() async {
        guard let clerk else {
            errorMessage = "Sign in on this iPhone to create an Event Card."
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
            location: location.trimmingCharacters(in: .whitespacesAndNewlines),
            opponent: eventType == "practice" ? "" : opponent.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        do {
            let token = try await SupporterHomeAPI.createEventCard(
                draft: draft,
                teamName: teamName,
                clerk: clerk
            )
            onCreated(token)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
