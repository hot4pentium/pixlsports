# Normal iPhone cold-launch check

The forced `--ui-testing-launch-splash` route is deliberately persistent and
skips Clerk setup. It proves only that the isolated splash can render; it does
not prove that normal authentication, layout, or dashboard loading works.

The reported device backtrace stopped in SwiftUI's first commit:
`GeometryReader.Child.updateValue` → Observation tracking → key-path hashing.
It did not show a crash or a wait inside Clerk configuration/networking.
Removing the outer auth GeometryReader/scroll viewport, nested dashboard
NavigationStack, and measured splash positioning addresses layout-feedback
risks. A single paused stack does not prove which one caused the hang.

## Checks available without Apple SDKs

```bash
node --test ios/Tests/NativeStartupLayoutSourceChecks.mjs
```

These are source-structure checks, not SwiftUI runtime or Apple build checks.

## Xcode / physical device

1. Preserve the existing app and its data. Do not uninstall to get a passing run.
2. Remove all `--ui-testing-*` arguments from the normal Run scheme.
3. Stop the previous run and build/run on the affected iPhone.
4. Confirm a visible white-textured splash, sign-in screen, dashboard, or clear
   retry state replaces the black screen. A forced-splash fixture is not a pass.
5. Stop Xcode, then force-quit/reopen the installed app from the phone Home Screen
   to separate normal startup from debugger symbol-loading delays.
6. Repeat with an existing signed-in session and a signed-out session; use a test
   account for sign-out so unsynced user work is not discarded.
7. Check sign-in email, Continue, verification/back navigation, Google, and keyboard
   visibility on a small phone and with large text. Header and form keep equal
   horizontal gutters. Child navigation should not introduce another root stack.
8. With a prepared signed-in test account, repeat offline. Show verified saved
   content or an explicit reconnect/retry; do not bypass account verification.

Run `SupporterDashboardUITests/testConfiguredColdLaunchReachesVisibleAndActionableContent`
with the installed Clerk configuration to exercise the real startup path.
Existing forced-splash and dashboard fixture tests are supplemental, not substitutes.

If black screen persists, pause and capture `thread backtrace -c 50` again,
including any messages before it. Do not interpret fatal-error strings in a
disassembly listing as proof that those instructions executed.
