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

The supporter view mounts mobile and desktop dashboard collections together, so duplicate card test IDs may refer to separate component instances and one can be visually hidden.

**Why:** A first-match DOM query can click or assert against the hidden copy, producing false failures for card state and focus restoration.

**How to apply:** Browser tests should select the rendered card or action with nonempty `getClientRects()` before interacting or reading flip state; focus should return to the exact visible trigger that opened the panel.

Card-flip focus must follow the committed visibility and inert state: focus a heading on the visible back face, then restore the stored trigger only after the front face is interactive again.

**Why:** Both faces remain mounted during the flip, so moving focus before the visible face is ready can target hidden or inert content, or lose focus during the state update.

**How to apply:** Scope focus movement to the open card and transfer it after each open or close state has rendered.

At extreme effective zoom widths, page-level horizontal overflow can come from fixed dashboard chrome rather than the Game On collection.

**Why:** A narrow Chromium viewport exposed a fixed mobile navigation row wider than the viewport even when card content remained contained.

**How to apply:** When a page overflow assertion fails, include element-level bounds in the diagnostic and separately measure the tested collection before changing its layout.

Standalone dashboard fixtures must wrap `SupporterDashboardView` in `ClerkProvider`, because the shared reply-inbox control calls `useUser` even when the test does not exercise authentication. When a synthetic user ID enables project queries, mock `/api/projects` with the generated response shape as well as the reply-inbox endpoint.

**Why:** Without the provider React unmounts the dashboard during render; without deterministic project data, ambient API responses can have a different shape and fail before the layout assertions run.

**How to apply:** Keep fixture auth context aligned with the mounted component tree and mock every enabled query that is irrelevant to the browser assertion.

Keep narrow card-state checks in a focused browser test, separate from the dashboard's longer tracker journey. Give each status-specific case an explicit fixture instead of assuming the shared fixture has a particular status.

**Why:** A broad dashboard check first failed because its default upcoming game was asserted as Complete, then reached an unrelated tracker-completion timeout after the card layout was already correct. A focused viewport check can give a trustworthy result for the card without hiding the separate failure.

**How to apply:** Test collapsed and expanded containment at the target widths in an isolated Chromium fixture; exercise Draft and Complete deliberately, and keep failures from later flows separately diagnosable.