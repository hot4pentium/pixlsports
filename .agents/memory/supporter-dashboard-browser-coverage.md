---
name: Supporter dashboard browser coverage
description: Constraints for rendering the supporter dashboard in isolated Chromium coverage.
---

Browser coverage for the supporter dashboard should use a standalone Vite HTML fixture rather than mounting over the live app shell. The reply inbox widget must receive the exact generated inbox response shape from its real endpoint, or an undefined response can unmount the dashboard before interaction assertions run.

**Why:** The live shell owns a React root that can replace a test DOM, and the inbox query renders alongside the dashboard even when the test only targets tool disclosure behavior.

**How to apply:** Keep dashboard browser tests isolated from the app shell, mock only unrelated API responses at their actual generated routes, and assert keyboard, route, and responsive behavior against the real dashboard component.