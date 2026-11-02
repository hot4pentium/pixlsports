---
name: Apple-native tooling boundary
description: Linux can expose a non-Apple xcodebuild executable; do not mistake it for available iOS validation.
---

The presence of `xcodebuild` or `xcrun` alone does not establish that Apple tooling
is available in this Linux workspace. A non-Apple `xcbuild` compatibility tool may
answer version queries without Apple SDKs. An off-PATH Swift compiler can also
parse sources while its Foundation dependencies cannot resolve SwiftGlibc.

**Why:** Native verification would be falsely reported as available if tool
discovery stopped at `command -v xcodebuild`.

**How to apply:** Check the operating system, build-tool version, Swift compiler,
and SDK discovery before promising native compilation or simulator tests.
Syntax parsing is not type checking or execution. Report server checks,
Foundation test execution, Apple-codec checks, and physical-iPhone checks separately;
none substitutes for the others.
