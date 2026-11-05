# Native Live Taps Apple verification evidence

## Mac run

The user ran the downloaded native verification project on their Mac on
November 4, 2026, local time. The output identifies the run directory timestamp
as `20261105T021918Z`, and reports an Xcode simulator build of the `PIXL Sports`
app. The user supplied the final 35 lines of Terminal output, not the full log.

Relevant supplied output, with machine-specific paths omitted:

```text
Result bundle written to path:
    .../SimulatorBuild.xcresult

** BUILD SUCCEEDED **

PASS: unsigned iOS Simulator app build.
Evidence: .../generated-artifacts/native-live-taps-apple/...
Physical iPhone, VoiceOver, Keychain interruption and offline radio checks were NOT run.
```

## What this establishes

- The Apple SDK app build completed successfully. The verification script's
  simulator build command disables signing.
- The script completed its final success branch. Its `set -euo pipefail` behavior
  requires the Apple Swift compilation and Foundation executable to return
  successfully before the app build is invoked. Thus Foundation execution
  success is inferred from successful completion of the supplied script, rather
  than from a separately supplied Foundation PASS line.
- The Foundation executable uses `-Onone` so its `precondition` checks execute.
  It covers opaque references when a game ID equals an Event Card ID, active
  versus completed personal totals, persisted legacy queues without references,
  retry of a lost accepted reply with the same UUID, one-time celebration after
  relaunch, account/link/invite isolation, and original per-item queued grants.

## Evidence limits

- The submitted tail does not include the Foundation PASS line, compiler/Xcode
  version output, or source manifest. Keep the complete `verification.log`,
  `source-status.txt` and build result bundle for future release evidence.
- This was a user-run Mac verification, not execution in the Linux workspace.
- Compilation does not execute the UIKit/Clerk outbox transport, server grant
  authorization, encrypted storage interruption behavior, or actual iOS UI.
  Server authorization and UUID deduplication were not changed.
- No physical-iPhone, VoiceOver, real offline-radio, or Keychain-interruption
  check is marked passed. Use the
  [focused device checklist](native-cheer-celebration-device-checks.md) for those.
- No CI workflow was enabled or pushed, and nothing was published.

## Repeat

With full Xcode 26+ selected and the iOS Simulator SDK installed, run:

```sh
bash ios/Tests/verify-live-taps-apple.sh
```

The full log and simulator result bundle are saved under the project's ignored
`generated-artifacts/native-live-taps-apple/` directory.
