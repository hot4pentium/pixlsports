# Local Event Card reminder acceptance checks

Status: Apple execution is required. These checks have **not** been run in the
Linux workspace. Swift syntax parsing and server tests do not verify iOS delivery.

Use the single Mac clone described in `ios/README.md`, preserve its native Clerk
configuration, pull the current source, and build the iPhone target in Xcode.
Use a physical iPhone for airplane mode and APNs/local handoff checks.

## Timing policy checks

From the repository root on the Mac:

```sh
swiftc "ios/PIXL Sports/NativeLocalReminderPlan.swift" \
  ios/Tests/NativeLocalReminderPlanChecks.swift -o /tmp/pixl-reminder-checks
/tmp/pixl-reminder-checks
```

## Device checks

Use two separately signed-in native accounts, including an independent iPhone
profile with the same email as a PWA profile. Do not link them or use production
family data. Enable reminder types only on these test accounts.

1. **Denied permission:** clean-install, sign in and download a future Event
   Card. Turn on “Remind me without reception” and deny the Apple prompt.
   The toggle must stay off with a Settings action; no pending local requests
   may exist. Grant permission in Settings, return, and enable again.
2. **No server push configuration:** with APNs unavailable in the test server,
   local opt-in must still succeed after authenticated subscription removal.
   A failed/uncertain removal must not activate local reminders.
3. **Airplane mode and relaunch:** download an event whose one-hour reminder is
   several minutes away, enable both reminder types, and inspect the pending
   requests in Xcode. Wait past the two-minute handoff window, enable airplane
   mode, lock the phone and observe one alert. Relaunch offline; reminders must
   remain present without registering APNs. No undownloaded event is included.
4. **Event day:** prepare an event before 7 a.m. in its saved account alert zone.
   Expect the Event day alert at 7 a.m., not in the phone's travel zone. One-hour
   timing follows the event zone. OS Focus/Scheduled Summary may delay presentation.
5. **Verified kickoff and time-zone edits:** before the alert fires, change the
   kickoff in the test account and refresh the native schedule online. Inspect
   pending requests: the old instant disappears and the new one appears with
   the same semantic identifier. Change the account alert zone in Settings;
   only Event day moves. Delete/cancel the event and refresh; its requests vanish.
6. **Offline edits elsewhere:** edit an event on another device while the phone
   is offline. The phone retains only its last verified schedule. Reconnect and
   refresh to replace it; no new unverified information is used offline.
7. **Push handoff and reconnect:** begin with server push enabled. Enable local
   reminders, then reconnect/relaunch and rotate the APNs token. The device's
   server subscription must remain absent. The PWA and other iPhone
   subscriptions/preferences must remain unchanged. A reminder within two
   minutes of opt-in is intentionally skipped, not backfilled.
8. **No replay:** let a local reminder fire, then refresh, change its kickoff,
   relaunch and toggle local reminders off/on. The same event/date/type must
   not alert again. Turning local reminders off does not automatically restore
   push. Trying to enable push while a previously fired local reminder is still
   valid must show the explicit “push can resume after” date; retry after that
   event's kickoff. Do not silently register the phone early.
9. **Account changes:** sign out, sign into the second native account, remove
   the account, revoke its link remotely, and test a direct SDK account switch.
   Pending and delivered local notifications disappear at the known boundary.
   The next account starts opted out, with no previous names/titles or reminders.
   A 401/403/410/423 response cancels local requests. A transient outage alone
   retains valid saved reminders.
10. **Access expiry:** with a controlled test clock/fixture, inspect an offline
    lease near its seven-day end. No request may fire after that end, and no
    reminder covers an event starting beyond it. Verify expiry while the app is
    terminated; enforcement cannot depend on a foreground timer.
11. **Interrupted/failed handoff:** interrupt notification setup, token
    registration, server removal, and local scheduling. Retry. There must never
    be concurrent local reminders plus a live server subscription for this
    phone. An iOS scheduling/storage failure must show a retryable error rather
    than silently claiming reminders are ready.

Record iPhone/iOS and Xcode versions, both authorization states, pending
request identifiers/fire times (no tokens), observed local/APNs delivery counts,
and pass/fail for every case before release.
