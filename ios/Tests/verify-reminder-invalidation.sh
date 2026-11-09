#!/bin/bash
# Deterministic standard-library checks; no SDK, device, network or consent changes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SWIFTC="${SWIFTC:-swiftc}"
OUTPUT="$(mktemp -d)"
trap 'rm -rf "$OUTPUT"' EXIT
POLICY="$ROOT/ios/PIXL Sports/NativeReminderInvalidationPolicy.swift"
CHECKS="$ROOT/ios/Tests/NativeReminderInvalidationChecks.swift"
if [[ "$(uname -s)" == Darwin ]]; then
  "$SWIFTC" -Onone -parse-as-library "$POLICY" "$CHECKS" -o "$OUTPUT/checks"
else
  # The workspace Swift compiler can emit standard-library objects even when
  # its own driver cannot locate Linux C startup files. Let the system cc link.
  SWIFT_ROOT="$(cd "$(dirname "$(readlink -f "$(command -v "$SWIFTC")")")/.." && pwd)"
  "$SWIFTC" -Onone -whole-module-optimization -module-name ReminderChecks \
    -parse-as-library -emit-object "$POLICY" "$CHECKS" -o "$OUTPUT/checks.o"
  cc "$OUTPUT/checks.o" -L"$SWIFT_ROOT/lib/swift/linux" \
    -Wl,-rpath,"$SWIFT_ROOT/lib/swift/linux" -lswiftCore -lswiftSwiftOnoneSupport \
    -o "$OUTPUT/checks"
fi
"$OUTPUT/checks"
node --test "$ROOT/ios/Tests/NativeToolAvailabilitySourceChecks.mjs"
