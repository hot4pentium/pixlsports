# Silent Prep checkoffs: native verification

Source checks do not establish SwiftUI frame stability or physical-iPhone smoothness.
Run the following on a Mac with Apple Xcode; do not report these native checks as
executed from Linux.

## Automated native cases

In `SupporterEventDetailUITests`, run:

- `testPrepCheckoffsKeepRowsStationaryInFullEventDetails`
- `testSignedInEarlyPrepCheckoffsStayStationaryDuringSaving`
- `testSignedInAvailablePrepCheckoffsStayStationaryDuringSaving`
- `testCompletingPrepKeepsChecklistExpandedAndAddingTaskKeepsRowsAvailable`
- `testSignedInQuickPrepCheckoffAutosavesAndPersistsAfterReopening`
- `testSignedInQuickPrepLostResponseRetriesSameMutationAfterRelaunch`

The first and fourth use fictional data. The signed-in cases need a disposable
development account already signed in and linked on the simulator/device.
Set these non-secret test environment identifiers:

- `PIXL_PREP_EARLY_TEST_EVENT_ID`: upcoming game more than ten minutes before start.
- `PIXL_PREP_AVAILABLE_TEST_EVENT_ID`: unfinished game within its tool-access window.
- `PIXL_PREP_TEST_EVENT_ID`: event for the existing persistence/lost-response cases.
- `PIXL_PREP_TEST_ITEM_ID`: an unchecked, initially visible task present in the
  configured test checklists. Leave at least one other task unchecked in these
  persistence cases; the fictional completion case covers the final checkoff.

The new signed-in layout cases delay the first real Prep save for three seconds,
sample row and event-hero positions without scrolling, reverse the checkoff
rapidly, verify acknowledgement, relaunch, and verify the final persisted state.
They restore the dedicated task afterward. Never use a real family's checklist.

## Physical iPhone/offline sequence

1. Open Prep in the full Event Details screen for a pre-unlock game, matching the
   user's recording. Scroll until a task is visible and record its screen position.
2. Check/uncheck that task repeatedly. Confirm immediate checkmarks, stable row
   positions, no scroll jump, no dirty banner, no saved-game panel and no saving
   announcement. Repeat inside the tool-access window and with a practice.
3. Go offline after the private checklist has downloaded. Repeat quick toggles,
   dismiss/reopen Event Details, terminate and relaunch the app. Confirm the final
   local selection remains. An offline explanation may remain; no per-tap save text
   should appear or disappear.
4. Reconnect. Confirm pending changes upload, row position remains stable through
   acknowledgement, and reopening/relaunching keeps the final selection.
5. Complete the last task. Its row stays available for an immediate uncheck; a
   temporary completion symbol uses the existing progress-circle space. The user
   can still explicitly collapse and expand the checklist.
6. Edit event notes without saving, then navigate away. Confirm manual-save
   protection remains. Force a genuine save/conflict failure on a disposable
   checklist and confirm the actionable recovery retains local changes; never
   discard them just to remove a notice.

Record device, iOS version, build commit, event timing, and results. Check the
actual rebuilt app, not an older installed build.
