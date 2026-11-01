---
name: Apple-native tooling boundary
description: Linux can expose a non-Apple xcodebuild executable; do not mistake it for available iOS validation.
---

The presence of `xcodebuild` or `xcrun` alone does not establish that Apple tooling
is available in this Linux workspace. A non-Apple `xcbuild` compatibility tool may
answer version queries even though no Apple SDK or Swift compiler is installed.

**Why:** Native verification would be falsely reported as available if tool
discovery stopped at `command -v xcodebuild`.

**How to apply:** Check the operating system, build-tool version, Swift compiler,
and SDK discovery before promising native compilation or simulator tests.
Report server checks, Apple-codec checks, and physical-iPhone checks separately;
none substitutes for the others.
