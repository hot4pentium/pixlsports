# Reminder preparation behavior checks

## Deterministic suite

From the repository root on a Mac with Xcode command-line tools:

```sh
bash ios/Tests/verify-reminder-behavior.sh
```

This compiles the **production** preparation worker, preparation pass, reminder
coordinator, and timing policy with in-memory schedule/workspace dependencies and
a controllable notification-center adapter. It does not run a second copy of the
algorithms, sign in, call APNs, prompt for permission, or touch the encrypted app
vault. Test preferences live in disposable UserDefaults suites.

The suite controls task order with continuations, not timing delays. A watchdog
fails a deadlock rather than hanging indefinitely. It covers:

- A new card syncing while an older workspace is downloading; repeated forced
  refreshes coalesce into one fresh pass.
- A card introduced by the pass's own sync, requiring a fresh verified schedule.
- An earlier failed download and a transport success not persisted to the vault.
- Removed downloads remaining removed, with later verified events still prepared.
- Cancellation/account changes during downloads and notification-center reads.
- An old worker completing after a replacement worker has begun.
- Overlapping reconciliations and duplicate event inputs submitting each
  unchanged accepted reminder once.
- Notification acceptance completing after cancellation: the late request is
  removed without erasing tool reminders or another feature's notifications.
- Notification rejection remaining retryable, without a false “saved” status.
- Linked schedule, readable prepared workspace, completion, permission, and
  consumed-reminder authority, including the APNs-resume exclusion window.

The same Foundation-only behavioral suite can run on Linux with a functioning
Swift/Foundation toolchain:

```sh
SWIFTC=/path/to/swiftc bash ios/Tests/verify-reminder-behavior.sh
```

The preparation worker/pass also have a separate **standard-library-only**
suite. It executes six controlled interleavings without Foundation, Combine, or
any Apple SDK:

```sh
SWIFTC=/path/to/swiftc bash ios/Tests/verify-event-preparation.sh
```

On Linux toolchains that package libdispatch separately, also set
`SWIFT_DISPATCH_LIBRARY_PATH` to its library directory. The script uses temporary
build outputs and the system linker; it does not change the app's build settings.

If the Linux toolchain is unavailable, run only the supplemental wiring guards:

```sh
node --test ios/Tests/NativeReminderPreparationSourceChecks.mjs \
  ios/Tests/NativeToolAvailabilitySourceChecks.mjs
```

Source guards are not a substitute for executing the behavioral suite.

## Apple SDK build

The live adapter converts accepted requests into absolute UTC, nonrepeating
`UNCalendarNotificationTrigger` values. It is iOS-only and must be compiled with
the rest of the real app, including the dedicated native Clerk dependency:

```sh
xcodebuild build -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

Do not replace the native Clerk configuration or copy web credentials to run
these checks. New source files join the existing filesystem-synchronized app
target automatically.

## Verification boundary

The fake center proves response ordering, rejection handling, and the number of
submissions. It **does not prove** Apple's OS accepted a real request, a banner
appeared, APNs delivered, or an alert fired with the app terminated/offline.
Those remain distinct physical-iPhone checks in
[`native-local-reminder-device-checks.md`](native-local-reminder-device-checks.md).
Existing user-reported push delivery is not a fresh airplane-mode test.
