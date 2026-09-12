---
name: Radix dialog runtime conflict
description: Runtime constraint encountered when adding the shared Radix Dialog component to the LeagueMatrix Vite artifact.
---

Avoid introducing the shared Radix Dialog component into this artifact without first confirming that dependency optimization resolves React from the same instance as the app.

**Why:** Adding the existing dialog wrapper compiled successfully but failed at runtime with an “Invalid hook call” immediately after Vite optimized `@radix-ui/react-dialog`. A small local overlay removed the duplicate-React failure.

**How to apply:** For new overlays in this artifact, use the existing local accessible overlay approach, or explicitly investigate and fix dependency deduplication before adopting Radix Dialog.