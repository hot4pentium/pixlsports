---
name: Supporter dashboard browser coverage
description: Constraints for rendering the supporter dashboard in isolated Chromium coverage.
---

Browser coverage for the supporter dashboard should use a standalone Vite HTML fixture rather than mounting over the live app shell. The reply inbox widget must receive the exact generated inbox response shape from its real endpoint, or an undefined response can unmount the dashboard before interaction assertions run.

**Why:** The live shell owns a React root that can replace a test DOM, and the inbox query renders alongside the dashboard even when the test only targets tool disclosure behavior.

**How to apply:** Keep dashboard browser tests isolated from the app shell, mock only unrelated API responses at their actual generated routes, and assert keyboard, route, and responsive behavior against the real dashboard component. When a React close handler restores focus in a later animation frame, wait for the expected `activeElement` in CDP assertions instead of checking immediately after unmount.

Stable `data-testid` hooks are preferable to reusing semantic IDs when browser checks need to measure or assert a rendered dashboard element.

**Why:** A responsive assertion can otherwise fail because its selector finds nothing, obscuring the actual layout result.

**How to apply:** Add a focused test hook for elements whose presence, dimensions, or visibility are part of browser coverage, while keeping the semantic `id` for accessibility relationships.

When multiple browser tests generate the same fixture files, serialize their Chromium runs or give each run unique fixture paths.

**Why:** Node can start top-level tests concurrently, and one test's cleanup can remove or replace the other test's live Vite page.

**How to apply:** Protect shared generated harness and HTML paths with a test-file lock before starting the Vite server; keep the lock release in `finally`.