# Fan Cheers and completion checks on an Apple runner

First run `bash ios/Tests/verify-live-taps-apple.sh` on macOS with Xcode 26+.
It executes the Foundation receipt model checks and builds the unsigned simulator
app. Linux syntax parsing does not execute those checks. Neither syntax parsing
nor the Foundation checks verify Clerk, Keychain, encrypted atomic writes or real
iOS presentation. A simulator build alone is not an executed UI/device check.

Status: **not executed on a physical iPhone, with VoiceOver, or with offline
radios for this verification path**. Record date, source revision, phone/iOS
versions and pass/fail evidence for each item below when actually performed.

Run the app target and UI tests in Xcode, then use two phones/accounts:

- Owner HYPE Card: keep Front, Videos, Stats and Events selected in turn while
  another phone cheers. Counts grow below the card; photo and selected face stay.
- End Live Taps with an active stats game, and again while stats are paused.
  Confirm the sheet shows the athlete/event, game count, sport breakdown and
  confirmed personal count. Stats, Event Card and QR access are unchanged.
- A participating family phone detects the explicit completion in foreground.
  A phone that never cheered must not show the sheet. Returning to a participated
  session may show it once; dismiss, reload and force-quit must not replay.
- Keep the scanner/another sheet open during the end. Do not stack modals.
  After closing it, confirm eligibility is still available.
- Queue taps offline. Deliver some, lose a successful response, then end remotely.
  Reconnect: accepted receipt is recovered once; rejected/pending taps stay
  separate. Confirm combined and personal totals are not confused.
- Interrupt the app during acknowledgement and during completion presentation.
  Reopen: receipt and outbox acknowledgement are either both saved or both
  retryable. No duplicate celebration, including after account switching.
- Check zero cheers, a previous-season game, new game, Dynamic Type accessibility
  sizes, VoiceOver heading/Done focus, Reduce Motion, landscape and home-indicator
  safe areas. All content scrolls vertically and dismisses.
- Sign out, change account link and return on another account: no old counts or
  modal can appear. Legacy receipts must not manufacture a personal number.
- Use a saved game whose ID equals its Event Card ID, hide the event, and recover
  an accepted cheer after End. Personal counts still match; recipient completion
  and receipt payloads use opaque references, not the hidden event identifier.
- Save cheers under QR grant A, revoke A and scan replacement B. Old queued taps
  retain A and their UUIDs; B must not authorize delivery of A's rejected taps.
  Also switch athlete invites: no previous invite's counts or celebration appear.
