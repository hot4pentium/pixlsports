# Native game-day access checks

Apple SDKs are required for the SwiftUI build and the UI tests. Source and
backend checks on Linux do not establish that the iPhone journey works.

## Automated on a Mac

- Run `NativeEventDetailStepChecks.swift` with `NativeEventDetailStep.swift`
  and `NativeEventGuideTiming.swift` to check the inclusive ten-minute boundary,
  completion, practices, missing dates and absolute DST/date-boundary instants.
- Run `SupporterEventDetailUITests.testEarlyGameLocksEntireTrackingTabWithoutBlockingPrepOrShare`
  and `testTrackingTabUnlocksAutomaticallyWithoutLeavingPrep`.
- Run the existing completed-game and Prep-draft/tool-switch tests.

## Signed-in iPhone or simulator

1. Create an independent account, complete athlete setup, and leave its starter
   HYPE Card private. Create a game 30 minutes ahead. Track Stats is disabled;
   the opening time is shown in the event's time zone. Prep and Share still work.
2. Move kickoff within ten minutes, or wait across the boundary without leaving
   Prep. The tab unlocks; it must not select itself or discard a Prep draft.
3. Choose Live Taps, choose the soccer format if needed, and start. Owner cheers
   work without creating a fan QR. Its default public-page pause stays on;
   public card/photo links must remain unavailable. Fan QR sharing stays
   disabled with an explanation while the page is paused.
   Separately unpause the public page in Settings without enabling HYPE Card
   sharing, then create a QR and verify that it targets this event.
4. While tracking, reschedule the event beyond ten minutes and background/resume.
   The event-linked chooser, recorder and full tracker are locked; queued stats
   and cheers remain. End/recover existing Live Taps from Share.
5. Finish the game locally without a connection. Track Stats stays disabled
   after reopening and after reconnecting. No timer can reopen a final game.
6. Confirm that a practice is unchanged, an invalid/missing start asks for a
   schedule correction, and standalone Record Moments still opens.
7. Repeat with a second account, a different sport, and a paused/expired card.
   Never show another account's context; give the real access error rather than
   asking an already-provisioned athlete to create a public Showcase.
   Explicitly saving Pause public page must stop owner Live Taps too; it is
   distinct from the automatic privacy pause assigned to a new starter card.
