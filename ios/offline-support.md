# iPhone offline support

## User behavior

Open PIXL online once and let **Saved on this iPhone** report that upcoming events
are ready. The dashboard restores saved data immediately. The app serially prepares
events in the next seven days after the dashboard loads (up to 24 per pass); opening
another event online prepares it too. Photos are small owner-authorized downloads;
videos are not downloaded.

Without reception, a previously verified account can reopen the app, view its saved
dashboard and prepared events, edit Prep tasks and notes, and start, pause, resume,
score, advance periods, undo stats, and finish a game. Checkboxes autosave; event
notes still require **Save** beside the Prep header chevron. Draft notes survive
relaunch without being published or silently submitted.

**Saved on this iPhone / waiting to sync** is not server confirmation. A local final
is provisional until acknowledged. Live Taps cannot reach fans offline.
Authentication, signup, schedule editing, profile/photo uploads, publishing, fan
QR changes, account removal, and sign-out require a connection. Existing downloaded
content does not grant publishing permission.

The app resumes ordered retries while foregrounded and connected, with bounded
backoff. iOS may suspend a background app; synchronization while suspended or
force-quit is not promised. A revision conflict retains pending work and requires
an explicit choice before discarding it for the current server version.

## Privacy / recovery

- The protected lease is issued only after the API accepts the native Clerk token
  and returns the verified native link. It is bound to issuer, subject, API origin,
  and that link—not email or PWA identity.
- Keychain device-only, when-unlocked storage holds the encryption key and the
  maximum seven-day local continuation. Files use authenticated AES-GCM, atomic
  writes, iOS complete file protection, and backup exclusion.
- This lease never authenticates a network request. Fresh network requests still
  require a real Clerk session and server authorization.
- Confirmed session expiry locks pending work for same-account reauthentication.
  Confirmed account/link revocation or accepted deletion clears private access.
  A denial-only marker fails closed if Keychain cleanup is interrupted; it can
  never grant access.
- Sign-out warns before discarding queued changes or drafts. Interrupted remote
  sign-out keeps a privacy curtain rather than reopening the dashboard.
- The outbox catalog also lives in Keychain, so a damaged disposable cache index
  cannot silently hide queued commands. Unreadable pending bytes are retained.
- Regular cache data has a roughly 60 MB budget; pending work has reserved capacity
  within an 80 MB ceiling. Cache eviction never intentionally removes a pending
  event's base workspace. A failed protected write is not reported as saved.

## Executable Foundation checks on a Mac

From the repository root:

```sh
swiftc -parse-as-library \
  "ios/PIXL Sports/NativeEventDurableQueue.swift" \
  "ios/PIXL Sports/NativeEventWorkspaceSnapshot.swift" \
  "ios/PIXL Sports/NativeOfflineLease.swift" \
  ios/Tests/NativeOfflineProjectionChecks.swift \
  -o /tmp/pixl-native-offline-checks &&
/tmp/pixl-native-offline-checks

swiftc -parse-as-library \
  "ios/PIXL Sports/NativeEventDurableQueue.swift" \
  ios/Tests/NativeEventDurableQueueChecks.swift \
  -o /tmp/pixl-native-queue-checks &&
/tmp/pixl-native-queue-checks
```

These cover local game projection and reload, attribution, intentional/no-score
results, period formats, bounded leases, identity mismatch, conflict detection,
immutable attempted mutations, protected-store failure, and corrupt outbox
preservation. Existing signed-in Prep UI tests also exercise a lost server response.

## Xcode / device verification

Use disposable development accounts and separate unused game events. Never use a
real season game for a test that finishes a tracker.

1. Run online, finish onboarding, and wait for upcoming-event offline readiness.
   Confirm the existing athlete/photo and event details are correct.
2. Turn on Airplane Mode (also turn Wi-Fi off), force-quit, and reopen. The dashboard
   must open without waiting for fresh Clerk environment/client requests.
3. Open a prepared event. Add and complete a custom task, change multiple tasks,
   type notes, and press header **Save**. Complete the list: it celebrates and
   collapses. Add a task: it opens. Relaunch offline and verify all saved states.
4. Type unsaved notes, navigate away/relaunch, and verify their draft returns.
   Toggling a checkbox must not silently submit those unsaved notes.
5. In a separate fresh game, choose Stat Tracker, start, add athlete/team stats and
   both scores, advance a period, pause/resume, undo, and finish. Relaunch offline.
   Verify the local result and the **waiting to sync** label, not a synced record.
6. Reconnect. Pending work should drain once in order without another tap, and
   records/public live data should update only after acknowledgements. Relaunch
   again: no duplicate starts, scores, task IDs, or final results.
7. Repeat with the development response-loss flag
   `--prep-save-lost-response-once` alongside `--ui-testing-signed-in-prep`.
   A retry must use the identical attempted mutation ID and payload.
8. Edit the same event from a second authorized device before reconnecting the
   first. Verify explicit conflict status, disabled further tracking, retained
   pending work, and confirmed discard/server reload. Do not auto-overwrite.
9. Attempt sign-out with pending work, first canceling and then confirming its loss.
   Sign in as another account: neither old content nor queued mutations may appear.
10. Verify accepted account removal still shows its receipt/support reference even
    if remote sign-out fails. Reopen offline: no old dashboard may appear.
11. Verify a lease older than seven days requires online verification; it must lock,
    not erase, uncertain mutations. Also test denied access after reconnect.

`NativeOfflineUITests` provides opt-in app-level forced-offline coverage. Its DEBUG
flag suppresses application API calls but cannot simulate the OS radio or prove
Apple SDK restoration behavior; steps 2 and 6 still need an actual device/simulator
network transition.

## Workspace verification boundary

### Optional local event reminders

Settings → **Remind me without reception** uses the saved account's Event day and
One hour before choices. It first verifies native access and acknowledges removal
of this phone's server push destination. It does not change the PWA identity,
other devices, or account-wide reminder preferences. Local mode does not require
APNs credentials on the server.

Only successfully downloaded game/practice workspaces from the verified schedule
are eligible. Start times and notification fire times must both fit inside the
existing seven-day offline lease. At most 48 earliest requests are installed.
Changed verified schedules/preferences rebuild requests; unknown remote changes
cannot be discovered while offline. iOS Focus, notification permission, and
Scheduled Summary still control presentation.

To prevent duplicate sources, local mode remains selected across reconnects and
token refreshes without re-registering APNs. The two-minute handoff window skips
imminent reminders. Turning local mode off cancels it but does not automatically
restore push. If a local alert may already have fired, push remains blocked for
that native account until the event's kickoff, when its server alert is no longer
eligible. Re-enabling local mode retains consumed event/date/type identifiers.

Locks, ownership replacement, confirmed sign-out, deletion, and 401/403/410/423
access denial cancel pending requests. The OS schedule itself is bounded, so
lease expiry does not depend on an app timer or a background network request.
See `Tests/native-local-reminder-device-checks.md` for required Apple acceptance
checks and the standalone timing executable. Apple execution remains outstanding.

Linux can parse the Swift sources and run the API regression tests. The existing
Swift 5.8 toolchain here cannot currently resolve its Foundation/SwiftGlibc module
graph, and no Apple SDK or iPhone simulator is available. Consequently Apple
compilation, the Foundation executables above, Keychain behavior on a signed app,
and device UI tests must not be described as executed in this workspace.
