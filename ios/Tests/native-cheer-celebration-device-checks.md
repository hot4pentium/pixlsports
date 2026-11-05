# Fan Cheers and completion checks on an Apple runner

Linux checks exercise the Foundation receipt model and syntax only. They cannot
verify SwiftUI, Clerk, Keychain, encrypted atomic writes, or real iOS presentation.

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
