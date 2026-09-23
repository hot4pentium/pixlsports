---
name: Wouter query routing
description: Query-driven page variants in Pixl Sports routing.
---

When a page variant is selected by a query parameter, read `window.location.search` directly instead of assuming Wouter's `useLocation()` value contains the query string.

**Why:** The meeting route initially rendered the generic checklist because Wouter supplied only the pathname to the route component, so an `eventType=meeting` variant check silently missed the query.

**How to apply:** Keep the route path stable when possible, but derive query-based rendering from browser search params and cover the exact URL in a browser test.