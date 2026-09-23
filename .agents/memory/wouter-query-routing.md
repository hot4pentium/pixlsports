---
name: Wouter query routing
description: Query-driven page variants in Pixl Sports routing.
---

When a page variant is selected by a query parameter, read `window.location.search` directly instead of assuming Wouter's `useLocation()` value contains the query string. When leaving a query-driven checklist variant, navigate to the dashboard path while preserving the artifact base path.

**Why:** The meeting route initially rendered the generic checklist because Wouter supplied only the pathname to the route component, so an `eventType=meeting` variant check silently missed the query. The meeting experience belongs on the dashboard flow, not the generic game checklist, and same-path Wouter updates can leave the query variant mounted.

**How to apply:** Keep the route path stable when possible, derive query-based rendering from browser search params, and replace the `/studio/checklist` suffix on the current browser pathname with `/studio` for reliable base-path-safe exit navigation. Cover both the exact URL and the exit action in a browser test.