---
name: Native iOS build validation
description: Where to validate the SwiftUI app when working from the Replit workspace.
---

The Replit Linux workspace has an `xcodebuild` compatibility shim but no Apple developer directory or iOS SDK. Native SwiftUI builds and simulator checks must be performed in Xcode on macOS.

**Why:** A workspace-side `xcodebuild` invocation failed because the Apple developer directory was unavailable.

**How to apply:** Use available source checks here, but report native build or simulator validation as unverified until the project is synced and built in Xcode.
