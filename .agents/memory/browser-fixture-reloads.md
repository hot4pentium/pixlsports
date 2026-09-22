---
name: Browser fixture reloads
description: How generated Vite browser-test pages behave when a test changes routes and then reloads.
---

Generated browser-test HTML can fall back to the app's normal SPA shell when a test changes the URL with history APIs before reloading. A direct navigation to the generated fixture URL restores the test harness and still exercises local-storage recovery across a fresh page load.

**Why:** A checklist browser flow initially appeared to reload successfully but was actually running the production route shell, which hid the harness and caused unrelated dashboard output.

**How to apply:** Keep route assertions in the harness, then navigate directly to the generated fixture URL with the test query and persisted state before calling the browser reload helper. Use a harness route marker when diagnosing this boundary.