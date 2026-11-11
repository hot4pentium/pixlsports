#!/usr/bin/env bash
# Runs production orchestration with controlled IO. No notification permission,
# APNs request, real account, Keychain change, or device alert is involved.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SWIFTC="${SWIFTC:-swiftc}"
OUTPUT="$(mktemp -d)"
trap 'rm -rf "$OUTPUT"' EXIT
bash "$ROOT/ios/Tests/verify-event-preparation.sh"
TARGET=()
if [[ "$(uname -s)" == Darwin ]]; then TARGET=(-target "$(uname -m)-apple-macosx13.0"); fi
"$SWIFTC" -Onone -parse-as-library "${TARGET[@]}" \
  "$ROOT/ios/PIXL Sports/NativeEventPreparationFlow.swift" \
  "$ROOT/ios/PIXL Sports/NativeEventReminderDependencies.swift" \
  "$ROOT/ios/PIXL Sports/NativeLocalReminderPlan.swift" \
  "$ROOT/ios/PIXL Sports/NativeLocalEventReminderCoordinator.swift" \
  "$ROOT/ios/Tests/NativeReminderBehaviorSupport.swift" \
  "$ROOT/ios/Tests/NativeReminderBehaviorChecks.swift" \
  -o "$OUTPUT/checks"
"$OUTPUT/checks"
node --test "$ROOT/ios/Tests/NativeReminderPreparationSourceChecks.mjs"
