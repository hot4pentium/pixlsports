---
name: Stale Vite preview processes
description: Distinguish a managed workflow's port conflict from an application crash.
---

A failed preview workflow can coexist with an older Vite process that still serves the correct port. A new workflow start then reports a port-in-use error even though the proxied app responds.

**Why:** After a task merge, the workflow reported failure while an earlier managed Vite process continued listening. The app code and preview were not the cause of the startup failure.

**How to apply:** Check the workflow output and port listener before changing the app. If the old managed process is orphaned, stop only that process group and restart the existing artifact workflow; do not create a replacement workflow or change ports.