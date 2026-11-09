import SwiftUI

/// Reserve the same wrapping space before and after unlock, including Dynamic
/// Type. Hidden sizing copies never become duplicate VoiceOver announcements.
struct NativeToolAvailabilityText: View {
    let access: NativeEventTrackingAccess
    let timeZone: TimeZone
    let opensAt: Date?
    let identifier: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            Group {
                Text(NativeEventTrackingAccess.available.message(timeZone: timeZone))
                Text(NativeEventTrackingAccess.complete.message(timeZone: timeZone))
                Text(NativeEventTrackingAccess.missingStart.message(timeZone: timeZone))
                if let opensAt {
                    Text(NativeEventTrackingAccess.tooEarly(opensAt).message(timeZone: timeZone))
                }
            }
            .hidden()
            .accessibilityHidden(true)
            Text(access.message(timeZone: timeZone))
                .accessibilityIdentifier(identifier)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Remains in the same place as availability changes; never opens a tool.
@MainActor
struct NativeToolAvailabilityNotice: View {
    let access: NativeEventTrackingAccess
    let timeZone: TimeZone
    let shareToken: String
    let subject: String?
    var opensAt: Date? = nil
    @ObservedObject private var reminders = NativeToolAvailabilityReminderCoordinator.shared

    private var canRemind: Bool {
        if case .tooEarly = access { return subject != nil }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NativeToolAvailabilityText(access: access, timeZone: timeZone,
                opensAt: opensAt, identifier: "native-tool-availability")
                .font(.caption.weight(.semibold))
                .foregroundStyle(NativeEventToolColors.trackStats)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 60, alignment: .topLeading)
            Button {
                guard let subject else { return }
                if reminders.selected.contains(shareToken) {
                    reminders.cancel(token: shareToken, subject: subject)
                } else {
                    Task { await reminders.optIn(token: shareToken, subject: subject) }
                }
            } label: {
                Label(buttonTitle, systemImage: reminders.selected.contains(shareToken) ? "bell.slash" : "bell")
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
            }
            .buttonStyle(.bordered)
            .disabled((!canRemind && !reminders.selected.contains(shareToken)) || reminders.busy.contains(shareToken))
            .accessibilityIdentifier("native-tool-availability-reminder")
            Text(reminders.errorMessage ?? reminders.messages[shareToken] ?? defaultMessage)
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 36, alignment: .topLeading)
                .accessibilityIdentifier("native-tool-reminder-status")
        }
        .task(id: subject) { if subject != nil { await reminders.reconcile() } }
    }

    private var buttonTitle: String {
        if reminders.busy.contains(shareToken) { return "Scheduling…" }
        if reminders.selected.contains(shareToken) { return "Cancel reminder" }
        if case .available = access { return "Available now" }
        if case .complete = access { return "Game complete" }
        return "Notify me"
    }

    private var defaultMessage: String {
        canRemind ? "Optional: one reminder on this iPhone when Stats and Live Taps open."
            : "Record Moments is available anytime. Tracking follows the game’s schedule."
    }
}
