# Native scoring compatibility and checks

## Intended behavior

A new Athlete scoring tap records one athlete event, one combined team stat and
the stat's established points once. A Team scoring tap contributes the same
points without an athlete event. Football opponent points remain opponent-owned.
Non-scoring stats contribute zero. Manual score corrections are independent.

## Compatibility and release ordering

- New iPhone stat commands carry `scoringVersion: 2`. Only newly created commands
  receive this field. Restored actions, including never-sent old actions, keep
  their original body and old scoring interpretation. Do not upgrade an outbox.
- Server validation accepts the optional literal `2` without a default. Missing
  fields retain the older athlete-zero-points policy and the existing receipt
  fingerprint. Unsupported versions fail validation instead of silently guessing.
- New saved plays record their actual `scoreDelta`, including an explicit zero.
  Undo uses this value. For metadata-free historical plays it preserves the old
  athlete-zero/team-rule-points interpretation. No historical score is rebuilt.
- Update the backend before installing a new iPhone build. An older backend
  rejects the new strict command field; the queued action must remain retained,
  not be retried with a modified body. Older installed apps keep legacy scoring
  until updated. Backend publication and GitHub push require separate approval.

## Server checks

From the workspace root:

```sh
pnpm --filter @workspace/league-matrix-studio exec tsx --test \
  ../api-server/src/lib/nativeEventTrackerScoring.test.ts \
  ../api-server/src/lib/nativeEventWorkspace.test.ts
```

The workspace tests create isolated development accounts and verify real
transactional receipts/retries. Never point them at production data.

## Native checks

These require a Swift compiler. They are not source-only JavaScript assertions.
On a Mac with Apple Xcode, from the repository root:

```sh
CHECK_DIR="$(mktemp -d)" &&
xcrun swiftc \
  "ios/PIXL Sports/NativeEventDurableQueue.swift" \
  "ios/PIXL Sports/NativeEventWorkspaceSnapshot.swift" \
  "ios/Tests/NativeAthleteScoringChecks.swift" \
  -o "$CHECK_DIR/native-scoring-checks" &&
"$CHECK_DIR/native-scoring-checks"
```

This covers point values, athlete/team attribution, opponent isolation, undo,
legacy plays, metadata round-trip and a relaunched mixed-version durable outbox.
The JavaScript source guards do not establish that Swift compiles.

For a rebuilt iPhone on a disposable development game, also verify: Athlete
touchdown → six team points and one athlete touchdown; Team touchdown → twelve
team points but still one athlete touchdown; opponent touchdown → six opponent
points. Go offline, add another athlete touchdown, relaunch, reconnect and confirm
acknowledgement never adds its six points again. Undo once must remove that
touchdown and its six points. Keep the older pending-action compatibility case
separate; it intentionally retains the old policy rather than rewriting history.
