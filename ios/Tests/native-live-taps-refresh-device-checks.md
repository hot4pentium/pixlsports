# Foreground Live Taps refresh

Structural regression checks (Linux or macOS):

```sh
node --test ios/Tests/NativeLiveTapsRefreshSourceChecks.mjs
```

These checks do not run SwiftUI or prove iOS task cancellation. Build with Xcode
and verify the following with a parent iPhone and a second family device on a
development account:

1. Open an active Event Card's Track Stats > Live Taps panel. Leave the parent
   untouched; send family cheers. After the current request and the five-second
   refresh delay, the parent's confirmed counts should update without a loading
   replacement, scroll jump, local cheer feedback or official-stat change.
2. Use Refresh cheers repeatedly during a slow request. Only the newest request
   may update the screen. Deliberately fail a request: keep the last counts and
   show the existing warning. Automatic retries wait fifteen seconds after a
   failure; manual refresh remains immediate. Recovery clears the warning.
3. Switch to Stat Tracker, Prep, or Share while leaving the Event Card mounted;
   then navigate away. Verify summary requests stop. Also background/lock the
   phone during a request and during the refresh delay. There must be no new
   summary requests until the tool is visible and the scene is active again.
   Returning should fetch immediately, not replay missed refresh intervals.
4. Disconnect the parent's network. Keep confirmed counts and locally saved
   cheers separate. Reconnect: confirm queued cheers send as before and remote
   totals refresh. No duplicate cheers or remote-send celebration should appear.
5. End the cheer session remotely; confirm the open parent panel stops offering
   cheer buttons after refresh. Start another session and verify the new
   session's totals replace, rather than merge into, the old totals. Any queued
   old-game cheers must remain attached to their original game.
6. With a request delayed, change Event Cards or sign out/switch accounts. Release
   the delayed response: it must not restore the old event's or account's counts
   or access. Repeat after account-link revocation. Reopening saved cheers is a
   separate retention check, not part of this live-update change.
7. Confirm family QR access requirements, revoked-link rejection, owner-only
   controls and the manual refresh action are unchanged.

Native build and device results must be reported separately from structural
checks or Swift syntax parsing; a Linux environment cannot verify this journey
on an iPhone.
