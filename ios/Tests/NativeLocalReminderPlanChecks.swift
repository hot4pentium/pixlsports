import Foundation

/// Run on a Mac without signing in or sending any notifications:
/// swiftc "ios/PIXL Sports/NativeLocalReminderPlan.swift" \
///   ios/Tests/NativeLocalReminderPlanChecks.swift -o /tmp/pixl-reminder-checks
/// /tmp/pixl-reminder-checks
@main
struct NativeLocalReminderPlanChecks {
    static func instant(_ text: String) -> Date {
        ISO8601DateFormatter().date(from: text)!
    }
    static func main() {
        let now = instant("2026-03-07T12:00:00Z")
        let leaseEnd = now.addingTimeInterval(7 * 86400)
        let preferences = NativeLocalReminderPreferences(oneHourBefore: true, dayOf: true,
                                                         timezone: "America/Los_Angeles")
        let start = NativeLocalReminderPlan.localInstant(date: "2026-03-08", time: "12:00",
                                                        timezone: "America/New_York")
        precondition(start == instant("2026-03-08T16:00:00Z"))
        let event = NativeLocalReminderPlan.Event(id: "game", date: "2026-03-08", start: start,
                                                 title: "Game vs Rivals", type: "game")
        func plan(_ events: [NativeLocalReminderPlan.Event] = [event],
                  prefs: NativeLocalReminderPreferences = preferences,
                  at: Date = now, boundary: Date = now, end: Date = leaseEnd) -> [NativeLocalReminderPlan.Reminder] {
            NativeLocalReminderPlan.reminders(events: events, preferences: prefs, now: at,
                                             notBefore: boundary, leaseEnd: end)
        }
        let reminders = plan()
        precondition(reminders.count == 2)
        precondition(reminders.first { $0.id.hasSuffix("one_hour") }?.fire == instant("2026-03-08T15:00:00Z"))
        precondition(reminders.first { $0.id.hasSuffix("day_of") }?.fire == instant("2026-03-08T14:00:00Z"))
        precondition(plan(prefs: .init(oneHourBefore: false, dayOf: false, timezone: preferences.timezone)).isEmpty)
        precondition(plan([]).isEmpty, "Undownloaded/unauthorized events never enter the plan.")
        precondition(plan(end: now).isEmpty, "Expired leases authorize no alerts.")
        precondition(plan(end: instant("2026-03-08T15:30:00Z")).isEmpty,
                     "Even an earlier reminder must not cover an event beyond the lease.")
        precondition(plan(boundary: instant("2026-03-08T14:30:00Z")).count == 1,
                     "Handoff window skips imminent or already in-flight push alerts.")
        precondition(plan(at: instant("2026-03-08T15:30:00Z")).isEmpty, "Never replay past reminders.")
        let moved = NativeLocalReminderPlan.Event(id: event.id, date: event.date,
            start: start!.addingTimeInterval(2 * 3600), title: event.title, type: event.type)
        let changed = plan([moved])
        precondition(changed.first { $0.id.hasSuffix("one_hour") }?.fire == instant("2026-03-08T17:00:00Z"))
        precondition(Set(reminders.map(\.id)) == Set(changed.map(\.id)),
                     "Kickoff edits retain semantic identity for consumed-alert suppression.")
        let changedZone = plan(prefs: .init(oneHourBefore: true, dayOf: true, timezone: "America/New_York"))
        precondition(changedZone.first { $0.id.hasSuffix("day_of") }?.fire == instant("2026-03-08T11:00:00Z"))
        precondition(changedZone.first { $0.id.hasSuffix("one_hour") }?.fire == instant("2026-03-08T15:00:00Z"))
        precondition(NativeLocalReminderPlan.localInstant(date: "2026-03-08", time: "02:30",
                                                        timezone: "America/New_York") == nil)
        precondition(NativeLocalReminderPlan.localInstant(date: "2026-11-01", time: "01:30",
                                                        timezone: "America/New_York") == instant("2026-11-01T05:30:00Z"))
        precondition(NativeLocalReminderPlan.localInstant(date: "2026-03-08", time: "12:00",
                                                        timezone: "not-a-zone") == nil)
        let many = (0..<80).map { NativeLocalReminderPlan.Event(id: "event-\($0)", date: event.date,
            start: start, title: "Practice", type: "practice") }
        precondition(plan(many).count == 48, "Stay below iOS's pending-request limit.")
        precondition(plan(many).allSatisfy { $0.fire <= leaseEnd && $0.title.contains("Practice") })
        let choice = NativeToolAvailabilityReminderPlan.Selection(eventID: event.id, shareToken: "private-event")
        func opening(_ selection: NativeToolAvailabilityReminderPlan.Selection = choice,
                     kickoff: Date? = start, at: Date = now, end: Date = leaseEnd) -> Date? {
            NativeToolAvailabilityReminderPlan.opening(start: kickoff, now: at, leaseEnd: end, selection: selection)
        }
        let fire = instant("2026-03-08T15:50:00Z")
        precondition(opening() == fire)
        precondition(opening(at: fire.addingTimeInterval(-0.001)) == fire)
        precondition(opening(at: fire) == nil, "Do not schedule late/immediate alerts at the inclusive unlock boundary.")
        precondition(opening(at: fire.addingTimeInterval(1)) == nil)
        precondition(opening(kickoff: nil) == nil)
        precondition(opening(end: fire) == nil, "The event, not just its alert, must be inside verified offline access.")
        var used = choice
        used.attemptedFire = fire
        precondition(opening(used, kickoff: start!.addingTimeInterval(86400), at: fire) == nil,
                     "A possibly delivered reminder cannot replay after a date edit.")
        used.consumed = true
        precondition(opening(used) == nil)
        let movedOpening = opening(kickoff: start!.addingTimeInterval(2 * 3600))
        precondition(movedOpening == fire.addingTimeInterval(2 * 3600))
        precondition(NativeToolAvailabilityReminderPlan.requestID(scope: "owner-a", token: "event")
                     != NativeToolAvailabilityReminderPlan.requestID(scope: "owner-b", token: "event"))
        precondition(NativeToolAvailabilityReminderPlan.capacity(otherCategoryCount: 0) == 16)
        precondition(NativeToolAvailabilityReminderPlan.capacity(otherCategoryCount: 4) == 12)
        precondition(NativeToolAvailabilityReminderPlan.capacity(otherCategoryCount: 80) == 0)
        for stamp in ["2026-11-01T05:05:00Z", "2026-11-01T06:05:00Z", "2026-03-08T07:05:00Z"] {
            let kickoff = instant(stamp)
            precondition(opening(kickoff: kickoff, at: kickoff.addingTimeInterval(-601),
                                 end: kickoff.addingTimeInterval(1)) == kickoff.addingTimeInterval(-600))
        }
        print("Native local reminder timing checks passed.")
    }
}
