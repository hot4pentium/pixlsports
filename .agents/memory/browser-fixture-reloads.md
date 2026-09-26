---
name: Browser fixture reloads
description: How generated Vite browser-test pages behave when a test changes routes and then reloads.
---

Generated browser-test HTML can fall back to the app's normal SPA shell when a test changes the URL with history APIs before reloading. A direct navigation to the generated fixture URL restores the test harness and still exercises local-storage recovery across a fresh page load. In route-aware harnesses, the query parameter selects the app view while `location.pathname` remains the generated fixture filename. For Vite fixture startup, use a complete HTML document with a cache-busted dynamic harness import and ensure mock share expirations are after the test clock.

**Why:** A checklist browser flow initially appeared to reload successfully but was actually running the production route shell, which hid the harness and caused unrelated dashboard output. A spectator fixture also rendered as a Vite syntax-error overlay until its inline entry was made consistent with the working harness, while a hard-coded past expiry masked the intended live state.

**How to apply:** Keep route assertions in the harness, then navigate directly to the generated fixture URL with the test query and persisted state before calling the browser reload helper. When using a route query, assert the harness's selected route marker rather than the fixture's `location.pathname`.

For query-flagged fixtures, an in-app navigation to `/` can also remove the flags before the harness remounts, silently disabling mocks or signed-in test state. Navigate to the original fixture URL (including query flags) when switching from a Calendar view to a dashboard view for cross-session assertions.

**Why:** A Calendar-to-dashboard test rendered the dashboard but never sent its account request because navigation discarded the fixture flag that supplied the test user.

**How to apply:** When a generated fixture relies on search parameters for route and identity, preserve them on every full-page view switch; wait for the expected request before asserting account synchronization.

Direct fixture navigation is not guaranteed to fix every blank reload. A dashboard selection fixture mounted on its first visit but returned an empty body after reload even when navigated to its direct fixture URL and given an explicit desktop viewport.

**Why:** Repeating a browser check against an empty fixture can consume time without telling us whether the app's selection logic is wrong.

**How to apply:** After a few different reload approaches leave the fixture blank, stop retrying that browser path. Keep the failed coverage out of the passing suite and verify the pure selection logic separately; only claim browser coverage after the fixture visibly mounts again.