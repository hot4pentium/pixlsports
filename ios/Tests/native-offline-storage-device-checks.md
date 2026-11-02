# Saved iPhone content: Apple acceptance checks

Run on a signed development build with disposable accounts/events. Linux policy
checks do not verify SwiftUI layout, the signed app's Keychain, physical disk-full
behavior, or VoiceOver. No published app or real season data should be changed.

## Removal and recovery

1. Prepare two upcoming events online. On one, queue Tracker commands and edit
   Prep, including unsaved notes, while offline. Cold-relaunch and confirm they
   restore before opening Settings → Saved iPhone content.
2. Check totals against encrypted files in the app container (not plaintext
   payload sizes). The pending event must show protection and no removal button.
   The other downloaded event offers removal. Cancel confirmation first: nothing
   changes. Confirm removal: the clean event needs an online download, but the
   pending event's Prep, notes, queue, and base workspace still restore offline.
3. Confirm **Remove disposable downloads** with pending work present. It must keep
   the schedule/profile, pending records, base workspace, and any unreadable pending
   file. Repeat with a test-damaged cache index but intact Keychain pending catalog:
   pending work and its base must never be candidates for removal.
4. Queue work while a clean event's confirmation is open, using a controlled
   debugger/test hook. Confirming must refuse that event's removal rather than use
   the earlier snapshot. No queued payload or mutation ID may change.
5. Reconnect, trigger background preparation, then remove a clean event while its
   request is in flight. A late reply must not recreate it. Force-quit/relaunch:
   routine preparation must still skip it. **Download again** online must restore
   readiness; offline the download button must be disabled. Opening the event
   online also permits normal use without removing its pending work.
   Repeat with an ordinary Event Card load already in flight (not the background
   worker): its delayed response must neither cache the workspace nor return stale
   content to its model. A new explicit open after removal must still succeed.

## Low storage and failed writes

1. Use a disposable simulator/device with limited free storage. Confirm the
   low-storage warning and exact space display. Pending writes must fail visibly,
   never claim success, and keep the previous committed queue/draft.
2. With protected pending bytes above the ordinary cache cap, remove clean
   downloads. Freeing files must happen before writing cleanup preferences, and
   small management metadata can use the pending reserve. Pending files and their
   base workspace must remain byte-for-byte intact.
3. Inject a file-deletion/index-write failure partway through removal. Show an
   explicit error, recount actual remaining usage, and keep all pending work.
   Never show a generic success after a partial failure.

## Accessibility and account isolation

1. Use VoiceOver and maximum accessibility text size in portrait and landscape.
   Every event must announce its title, date, readiness, and protection. Removal
   and download buttons must identify their event; confirmation must describe
   protected data and online re-download. Cancel must return to usable controls.
   Success and errors must be announced without relying on color.
2. Sign in as a second account (including the same event-token fixture if possible).
   No first-account event names, usage, queue, drafts, or removal preferences may
   appear. An account/link change or lease expiry while the storage screen or
   confirmation is open must hide old details and prevent the old action.
3. Toggle other Settings preferences and alter ordinary UserDefaults values.
   Neither may unlock an expired/locked lease or enable offline access for a
   different identity. Reauthentication, revocation, deletion, and sign-out must
   preserve the pre-existing privacy behavior.
