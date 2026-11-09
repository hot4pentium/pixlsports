# Native game-day access checks

Apple SDKs are required for the SwiftUI build and the UI tests. Source and
backend checks on Linux do not establish that the iPhone journey works.

## Automated on a Mac

- Run `NativeEventDetailStepChecks.swift` with `NativeEventDetailStep.swift`
  and `NativeEventGuideTiming.swift` to check the inclusive ten-minute boundary,
  completion, practices, missing dates and absolute DST/date-boundary instants.
- Run `NativeLocalReminderPlanChecks.swift` with `NativeLocalReminderPlan.swift`
  for opt-in timing, consumed attempts, account namespaces, and shared capacity.
- Run `SupporterEventDetailUITests.testEarlyGameKeepsChooserAndRecordMomentsAvailable`
  and `testTrackingTabUnlocksAutomaticallyWithoutLeavingPrep`.
- Run `testRecordingSurvivesAutomaticToolUnlock` and the completed-game test.
- Run the existing completed-game and Prep-draft/tool-switch tests.

## Signed-in iPhone or simulator

1. Create an independent account, complete athlete setup, and leave its starter
   HYPE Card private. Create a game 30 minutes ahead. Track Stats opens its chooser;
   only Stats and Live Taps are disabled. Their opening time includes the event
   time zone. Record Moments works now. Prep and Share still work.
2. Move kickoff within ten minutes, or wait across the boundary without leaving
   Prep or Record Moments. The timed tools unlock; navigation and editing must
   not change and no Prep draft or clip can be discarded.
3. Choose Live Taps, choose the soccer format if needed, and start. Owner cheers
   work without creating a fan QR. Its default public-page pause stays on;
   public card/photo links must remain unavailable. Fan QR sharing stays
   disabled with an explanation while the page is paused.
   Separately unpause the public page in Settings without enabling HYPE Card
   sharing, then create a QR and verify that it targets this event.
4. While tracking, reschedule the event beyond ten minutes and background/resume.
   The chooser and recorder remain available; Stats, new Live Taps, and the full
   tracker are locked. Queued stats and cheers remain. End/recover cheers from Share.
5. Finish the game locally without a connection. Track Stats still opens its
   chooser, but only Record Moments is selectable. Reconnect and reopen; no timer
   can restart tracking or start another Live Taps session for that final game.
6. Confirm that a practice is unchanged, an invalid/missing start asks for a
   schedule correction, and standalone Record Moments still opens.
7. Repeat with a second account, a different sport, and a paused/expired card.
   Never show another account's context; give the real access error rather than
   asking an already-provisioned athlete to create a public Showcase.
   Explicitly saving Pause public page must stop owner Live Taps too; it is
   distinct from the automatic privacy pause assigned to a new starter card.

## Optional availability reminder

1. Leave normal event-day and one-hour alerts off. For a downloaded game within
   verified offline access, opt into Notify me. Permit notifications and confirm
   the app says the reminder is saved only after iOS accepts it. Denying permission
   must leave Record Moments working and explain iPhone Settings.
2. Check one request at kickoff minus ten minutes. Opt out, reopen, and opt in
   again; cancellation and scheduling survive relaunch. No duplicate request.
3. Move kickoff/date/time zone while offline, including DST transitions. The old
   pending request is replaced. Delete or finish locally before sync; the request
   disappears and is not restored by an older schedule response.
4. Background the app and confirm one alert without reception. In foreground,
   availability changes inline, without an extra banner or sound. Reopening or
   postponing an already-consumed event must not replay it without another opt-in.
5. Mix tool reminders with event-day/one-hour reminders, change local/APNs modes,
   and disable normal alerts. Neither category erases or duplicates the other.
   Verify capacity-full and iOS scheduling failures do not claim success.
6. Sign out, unlink, change accounts, and exhaust the offline lease. Old requests
   are cancelled; late permission/scheduling callbacks cannot revive them.
