#!/bin/bash
# Run with bash from any directory. Never signs, installs, pushes, or publishes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Apple verification requires macOS with full Xcode 26+ and an iOS Simulator SDK." >&2
  exit 1
fi
cd "$ROOT"
OUTPUT="$ROOT/generated-artifacts/native-live-taps-apple/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$OUTPUT"
exec > >(tee "$OUTPUT/verification.log") 2>&1
echo "Native Live Taps Apple verification"
if [[ -f "$ROOT/SOURCE_REVISION.txt" ]]; then
  echo "Source: downloaded verification bundle"
  cat "$ROOT/SOURCE_REVISION.txt"
  cp "$ROOT/SOURCE_REVISION.txt" "$OUTPUT/source-status.txt"
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Source: $(git rev-parse HEAD) (see source-status below for local changes)"
  git status --short > "$OUTPUT/source-status.txt"
else
  echo "Source: unversioned local copy; record the source revision before using this as release evidence."
  echo "Unversioned local copy; source revision not available." > "$OUTPUT/source-status.txt"
fi
echo "Developer directory: $(xcode-select -p)"
xcodebuild -version
xcrun --sdk macosx swiftc --version
xcrun --sdk iphonesimulator --show-sdk-version
MAC_SDK="$(xcrun --sdk macosx --show-sdk-path)"

# No optimization: precondition assertions must execute. No Clerk or network needed.
xcrun --sdk macosx swiftc -sdk "$MAC_SDK" -Onone -parse-as-library \
  "ios/PIXL Sports/NativeLiveTapContributions.swift" \
  ios/Tests/NativeLiveTapContributionChecks.swift \
  -o "$OUTPUT/live-tap-contribution-checks"
"$OUTPUT/live-tap-contribution-checks"
echo "PASS: Apple Foundation contribution checks executed."

# Full app compilation includes UIKit, Clerk, vault/storage and the outbox.
# Generic simulator destination needs no booted simulator or signing credentials.
xcodebuild build -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$OUTPUT/DerivedData" \
  -resultBundlePath "$OUTPUT/SimulatorBuild.xcresult" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""
echo "PASS: unsigned iOS Simulator app build."
echo "Evidence: $OUTPUT"
echo "Physical iPhone, VoiceOver, Keychain interruption and offline radio checks were NOT run."
