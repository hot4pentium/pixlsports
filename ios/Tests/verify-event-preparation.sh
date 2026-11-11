#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SWIFTC="${SWIFTC:-swiftc}"
OUTPUT="$(mktemp -d)"
trap 'rm -rf "$OUTPUT"' EXIT
FLOW="$ROOT/ios/PIXL Sports/NativeEventPreparationFlow.swift"
CHECKS="$ROOT/ios/Tests/NativePreparationBehaviorChecks.swift"
if [[ "$(uname -s)" == Darwin ]]; then
  "$SWIFTC" -Onone -parse-as-library -target "$(uname -m)-apple-macosx13.0" \
    "$FLOW" "$CHECKS" -o "$OUTPUT/checks"
else
  # No Foundation or Apple SDK dependencies. As with reminder-invalidation
  # checks, use the system linker when Swift's Linux driver lacks startup files.
  SWIFT_ROOT="$(cd "$(dirname "$(readlink -f "$(command -v "$SWIFTC")")")/.." && pwd)"
  DISPATCH_LIB_DIR="${SWIFT_DISPATCH_LIBRARY_PATH:-$SWIFT_ROOT/lib/swift/linux}"
  "$SWIFTC" -Onone -whole-module-optimization -module-name PreparationChecks \
    -parse-as-library -emit-object "$FLOW" "$CHECKS" -o "$OUTPUT/checks.o"
  cc "$OUTPUT/checks.o" -L"$SWIFT_ROOT/lib/swift/linux" \
    -L"$DISPATCH_LIB_DIR" -Wl,-rpath,"$SWIFT_ROOT/lib/swift/linux" -lswiftCore \
    -lswiftSwiftOnoneSupport -lswift_Concurrency -ldispatch -o "$OUTPUT/checks"
  export LD_LIBRARY_PATH="$DISPATCH_LIB_DIR:$SWIFT_ROOT/lib/swift/linux${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
"$OUTPUT/checks"
