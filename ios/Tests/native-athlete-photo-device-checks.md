# Native HYPE Card photo verification

## Status

Apple-native preparation checks have been added but **not compiled or run** in
the Linux workspace. Its `xcodebuild -version` reports `xcbuild version 0.1`
(a non-Apple build tool); `xcrun --sdk iphoneos --show-sdk-path` fails with
`unable to find developer root`. There is no Swift compiler, Apple SDK,
simulator, Xcode, or attached iPhone here.

Executed successfully in this workspace:

```sh
pnpm --filter @workspace/league-matrix-studio exec tsx --test \
  ../api-server/src/lib/nativeAthletePhoto.test.ts
```

Result: 10 passed, 0 failed, 0 skipped.

The device checks below are **not verified**. Server checks are separate evidence,
not a substitute for iCloud Photos, PhotosPicker, or relaunch checks on iOS.

## Preparation checks on a Mac

From the repository root, with Apple Xcode selected:

```sh
xcrun swiftc -parse-as-library \
  "ios/PIXL Sports/NativeAthletePhotoPreparation.swift" \
  ios/Tests/NativeAthletePhotoPreparationChecks.swift \
  -o /tmp/pixl-athlete-photo-checks
/tmp/pixl-athlete-photo-checks
```

These run the production ImageIO helper, generating fixtures in memory:
all eight JPEG EXIF orientations (including mirrored), rotated HEIC, a large
4096×3072 rotated source, unreadable/truncated/empty input, and source data over
40 MB. They check actual quadrant colors, upright dimensions, the 2048-pixel
bound, JPEG output under 5 MB, and removal of source GPS/comments/orientation.
HEIC encoding failure fails the checks explicitly; it is not silently skipped.
macOS codec results do not establish behavior of an iOS PhotosPicker.

## Actual iPhone check in Xcode

Use a signed-in, linked **test** account with an existing athlete HYPE Card.
Use fictional/non-sensitive photos with obvious "TOP" markings. Record the
iPhone model, iOS version, Xcode version, and outcomes; do not record credentials.
Run on a physical iPhone, not only a simulator.

1. In Settings → Athlete profile, note the existing photo. Record the card's
   public/private, paused, Stats, and Events settings on the web.
2. Open Replace photo and cancel without selecting. Confirm the prior preview
   remains, no saving/success state appears, and Replace still opens the picker.
   Repeat cancellation after a successful upload.
3. Choose an iCloud-only image with Optimize iPhone Storage enabled. Ensure it
   really needs downloading (not a locally cached original). Confirm the saving
   indicator remains responsive during download, then an upright preview appears.
   Repeat while offline: the error must leave the prior photo intact. Reconnect
   and select the same image again; confirm recovery.
4. Upload rotated JPEG, mirrored JPEG, HEIC, and a large camera image.
   Confirm "TOP" is upright and no unexpected crop/flip occurs in native Settings
   and the matching web HYPE Card. This changes the existing card photo only.
5. For upload failure, first use a locally available image. With networking
   disabled (or a controlled test-server rejection), select Replace and wait for
   the error. The prior preview must remain; controls must re-enable. Restore
   networking and retry the same selection successfully.
6. After success, force-quit and relaunch. Sign back in if needed and reopen
   Settings. Confirm the replacement loads from the server, not a temporary
   picker preview. Confirm the web HYPE Card has the same photo.
7. Tap Remove photo. Before confirming, the preview and server photo must remain.
   Cancel the confirmation and verify nothing changes. Reopen, confirm removal,
   relaunch, and verify the photo stays removed on native and web.
8. Repeat the successful replacement/removal on private and public test cards.
   Neither action may change visibility, paused state, Stats, or Events settings.
   No background-removal flow or separate athlete profile-photo store should appear.
9. While Settings is open, replace the photo on the web. Attempt a native change
   with the old revision: expect a conflict, not overwriting the newer image.
   Tap Refresh photo and retry. Sign out and verify the prior account's image
   is absent before signing in to a different account.

## Evidence boundaries

`artifacts/api-server/src/lib/nativeAthletePhoto.test.ts` checks server-side
privacy/settings preservation, invalid input, stale revisions, ownership,
unlinking, removal persistence, storage failure preserving readable old bytes,
retry with the same revision, and loading the replacement via a fresh service.
This models a fresh server read, **not an actual iPhone relaunch**.

Code inspection of `NativeAthletePhotoSection` confirms selection `nil` is a
no-op, failed preparation/upload leaves `photoState` and `photo` unchanged,
the working state and picker selection reset on exit, and deletion is called
only from the destructive confirmation action. These are inspection findings,
**not executed UI tests**. A failed preview after a successful save has a separate
saved-but-preview-unavailable message and Refresh action.
