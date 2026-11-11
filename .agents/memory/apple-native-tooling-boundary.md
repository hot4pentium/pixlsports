---
name: Apple-native tooling boundary
description: Linux can expose a non-Apple xcodebuild executable; do not mistake it for available iOS validation.
---

The presence of `xcodebuild` or `xcrun` alone does not establish that Apple tooling
is available in this Linux workspace. A non-Apple `xcbuild` compatibility tool may
answer version queries without Apple SDKs. An off-PATH Swift compiler can also
parse sources while its Foundation dependencies cannot resolve SwiftGlibc.

The available Swift 5.8 module was not sufficient by itself to execute a
Foundation-based check: its outer wrapper cleared PATH, while the raw compiler
could report its version without finding Foundation. Installing a module is not
verification that these dependencies work. Smoke-compile the actual imports;
use standard-library-only checks or the Mac instructions when they do not.

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

For native media work, verification must invoke the production AVFoundation
exporter on Apple platforms. A Linux/FFmpeg reconstruction of the intended video
is not evidence that the iPhone exporter produced that file.

**Why:** Composition duration alone cannot establish the encoded MP4's duration,
frame order, selected tail footage, orientation, or retained audio.

**How to apply:** Keep an Apple-run synthetic-media harness for file inspection,
and report camera, Photos permission/write, and native share-target checks as
separate physical-device evidence.
