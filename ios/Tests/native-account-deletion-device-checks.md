# Account removal on an iPhone

Run on a Mac with the current Xcode project and a disposable account in the
dedicated native Clerk test tenant. Do not run destructive checks with a real
user or production account. Linux server checks do not compile SwiftUI or
verify ClerkKit's local-session teardown.

## Independent profile

1. Create a native-only athlete profile, a photo, an Event Card and a HYPE Card.
   Enable alerts on two test devices.
2. In Settings, open **Delete account or remove iPhone access**. Verify the
   confirmation lists the independently owned profile, cards, stats, checklists,
   projects, photos/videos, alerts and shared links; it explains permanence,
   device-saved media and the retained minimal deletion record.
3. Choose **Keep my account**. Reload Settings and the dashboard. Nothing should
   change and alerts should remain registered.
4. Repeat and confirm **Delete iPhone account**. Check the progress state prevents
   a second tap and dismissal, then returns to signed-out UI without displaying
   the prior athlete's cached dashboard.
5. Confirm that another device cannot load private data or register push again.
   Existing native sessions must no longer be usable. Verify provider deletion
   used the native issuer/subject, never the managed PWA tenant.
6. Confirm uploaded photo objects, private profile, cards and their public links
   are removed after cleanup. Locally downloaded media is unaffected.
7. Force a provider or storage failure using a test double, not live
   configuration. The committed request must remain pending, deny access and
   onboarding, and complete on retry without restoring the account.

## Existing legacy-linked profile

1. Use a disposable verified legacy native-to-web binding.
2. Verify the confirmation says **Remove iPhone access**, and explicitly states
   that the PWA identity, athlete profile, cards, media, stats, shared links and
   web alerts are preserved.
3. Cancel, reopen and confirm. Verify all native delivery targets and the binding
   are removed and native sessions are revoked, while the PWA still signs in,
   edits its existing data, and opens the same public links.

## Recovery and accessibility

- Interrupt the connection immediately after confirmation. Reopen Settings.
  If the server accepted removal, a still-valid session can read the pending
  removal status and finish signing out. If it did not, review and retry.
- Interrupt local sign-out after acceptance. **Finish signing out** must retry
  local sign-out without attempting to unregister an already revoked identity.
- Use the largest accessibility text size and VoiceOver. Check the scope message,
  destructive action, cancellation and error/retry controls remain reachable.
- After acceptance, check the signed-out receipt shows a support reference UUID
  and **Copy support reference** copies exactly that value (not an email, athlete
  name, target or sign-in token). Repeat for independent and legacy-linked removal.
- Relaunch before dismissing the receipt; the same reference must remain visible.
  Confirm **Back to sign in** clears both the receipt and its reference, and an
  older device receipt without a reference still renders without a blank copy action.
- With a simulated lost POST response, reopen Settings using the still-valid
  session. The authenticated preview must restore the same reference before
  local sign-out. Retry a failed local sign-out and confirm it is not lost.
- Compare the eventual completion email with the device receipt: both must use
  the exact same UUID, and neither receipt should retain athlete details or a
  recipient address on the signed-out device.
- Automated server tests cover invalid/PWA authentication, cross-account
  confirmation denial, changed targets, duplicate requests, lifecycle terminal
  states, provider-connection mismatch, provider 404 retries, media failures and
  prevention of deletion-pending onboarding.
