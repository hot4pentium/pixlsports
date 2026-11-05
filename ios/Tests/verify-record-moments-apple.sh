#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Record Moments Apple checks require macOS with full Xcode and Apple SDKs." >&2
  exit 1
fi
cd "$ROOT"
OUTPUT="$ROOT/generated-artifacts/native-record-moments/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$OUTPUT"
exec > >(tee "$OUTPUT/verification.log") 2>&1
xcodebuild -version
xcrun --sdk iphonesimulator --show-sdk-version
MAC_SDK="$(xcrun --sdk macosx --show-sdk-path)"
xcrun --sdk macosx swiftc -swift-version 5 -sdk "$MAC_SDK" -Onone -parse-as-library \
  "ios/PIXL Sports/NativeMomentPlan.swift" ios/Tests/NativeMomentPlanChecks.swift \
  -o "$OUTPUT/plan-checks"
"$OUTPUT/plan-checks"
xcrun --sdk macosx swiftc -swift-version 5 -sdk "$MAC_SDK" -Onone -parse-as-library \
  "ios/PIXL Sports/NativeMomentPlan.swift" "ios/PIXL Sports/NativeMomentExporter.swift" \
  ios/Tests/NativeMomentExportChecks.swift -o "$OUTPUT/export-checks"
"$OUTPUT/export-checks" "$ROOT" "$OUTPUT/mp4-evidence"
xcodebuild build -project "ios/PIXL Sports.xcodeproj" -scheme "PIXL Sports" \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$OUTPUT/DerivedData" CODE_SIGNING_ALLOWED=NO
echo "PASS: Apple export checks and unsigned simulator app build."
echo "Still required: physical-iPhone checks in ios/Tests/native-record-moments-device-checks.md."
