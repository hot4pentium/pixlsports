# Owner HYPE Card offline checks

Run on an Apple simulator/device with Xcode and a dedicated, already signed-in
development owner account. Do not use a real family account. These are Apple UI
and device checks, not checks that the Linux source-test runner can perform.

The automated UI test covers a single configured visibility state per run:

```sh
PIXL_HYPE_CARD_OFFLINE_VISIBILITY=public xcodebuild test \
  -project "ios/PIXL Sports.xcodeproj" -scheme "PIXL Sports" \
  -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/NativeHypeCardOfflineUITests/testPublicOwnerCardPhotoAndSettingsRestoreOffline

PIXL_HYPE_CARD_OFFLINE_VISIBILITY=hidden xcodebuild test \
  -project "ios/PIXL Sports.xcodeproj" -scheme "PIXL Sports" \
  -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/NativeHypeCardOfflineUITests/testHiddenOwnerCardPhotoAndSettingsRestoreOffline

PIXL_HYPE_CARD_OFFLINE_VISIBILITY=hidden xcodebuild test \
  -project "ios/PIXL Sports.xcodeproj" -scheme "PIXL Sports" \
  -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/NativeHypeCardOfflineUITests/testRevokedLinkCannotRestoreHiddenOwnerCardOffline

PIXL_HYPE_CARD_OFFLINE_VISIBILITY=public xcodebuild test \
  -project "ios/PIXL Sports.xcodeproj" -scheme "PIXL Sports" \
  -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/NativeHypeCardOfflineUITests/testReopenedCardMergesRemoteOnlyAndSameFieldSettingsChanges
```

Sign in to the matching owner in the simulator before each run, and make sure
the owner card has a photo. The test first loads the owner card online, changes
only the local stats setting, then force-quits/relaunches with owner API access
disabled. It checks the saved photo, the public/private presentation, and the
unsynced setting. It finally opens the signed-out public recipient fixture in
the same app installation and verifies that owner-only content and controls do
not appear. This app-level offline switch does not simulate Clerk being unable
to contact its servers; use the Airplane Mode steps below for that check.

1. For Clerk cold-start coverage, load the owner's HYPE Card once while PIXL is
   reachable, including its photo. Turn on Airplane Mode and turn Wi-Fi off,
   force-quit, and reopen. Wait while Clerk restores: the previously verified
   owner must still be allowed to continue to the saved dashboard and HYPE Card.
   Confirm the card, photo, and offline status appear without a fresh request.
2. Repeat steps 1 and the automated UI test with separate public and hidden-card
   development owners. For the hidden owner, verify the private preview has its
   photo and never exposes a share link or changes privacy.
3. Offline, change the stats setting and tap Save. Expect a saved-on-this-iPhone
   message, not a cloud-save confirmation. Force-quit/relaunch and verify the
   choice remains editable. Reconnect and explicitly tap Save to sync it.
4. For a settings conflict, save one field locally while offline, change a
   different field on a second authorized device, then reconnect the first.
   The first device must retain its local field choice and the remote-only
   change; it must not replace either with stale settings. Repeat with the same
   field changed on both devices and verify the iPhone's local edit is preserved
   for review/save rather than silently discarded.
   The automated UI test runs the equivalent sequence against a dedicated
   public development owner: it stores a distinct favorite-moment edit locally,
   applies an independent authenticated PIXL update to that same field and to
   Event Cards, then relaunches to verify the iPhone choice and remote-only
   setting are both retained. It saves the rebased draft and restores the
   development owner's original settings before finishing.
5. With networking enabled, make the API unreachable. A previously saved card
   and photo must remain visible. An unconfirmed in-flight save must still
   require checking saved status before another cloud write.
6. After warming an owner preview, open a public recipient link on the same
   installation. It must show only the shared public card, never the owner's
   hidden private preview, photo bytes, or settings controls. Then sign out and
   sign in as a different development account: the prior owner's card, photo,
   settings draft, and pending save must not appear or be sent for the new
   account. Verify the old account's own data is still available after signing
   back into that account.
7. Run `testRevokedLinkCannotRestoreHiddenOwnerCardOffline` with a dedicated
   hidden development owner. It saves a local settings draft, disconnects the
   real server link through the app, and relaunches offline. The connection gate
   must appear without the card, photo, or settings. Then reconnect and sign
   out/in to the same iPhone account while its PIXL link remains disconnected;
   cached card access must stay blocked until the account is explicitly linked
   again.
8. On a fresh install with no saved card, offline mode should explain that a
   first successful connected load is needed; it must not fabricate a card.

The Linux checkout does not include Apple's SDKs or iOS Simulator. Linux source
checks are not an Xcode build and do not complete these Apple-only checks.
