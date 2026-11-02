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

Pure standard-library Swift checks can still execute in this Linux environment;
do not equate unavailable Foundation/Apple SDKs with an unavailable Swift language
runtime. The bundled compiler driver may fail to locate C startup objects even
when the system C linker can link a Swift object successfully.

**Why:** The compiler, Foundation module graph, system linker, and Apple SDK are
independent availability boundaries. A linker setup failure is not a test failure
or proof that all Swift execution is impossible.
