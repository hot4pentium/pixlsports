---
name: Wouter query routing
description: Query-driven page variants in Pixl Sports routing.
---

When a page variant is selected by a query parameter, read `window.location.search` directly instead of assuming Wouter's `useLocation()` value contains the query string. When leaving a query-only variant for the same pathname, use a full navigation to the current pathname without the query.

**Why:** The meeting route initially rendered the generic checklist because Wouter supplied only the pathname to the route component, so an `eventType=meeting` variant check silently missed the query. Later, setting the same Wouter pathname did not unmount the meeting variant because only the query changed.

**How to apply:** Keep the route path stable when possible, derive query-based rendering from browser search params, and use the current browser pathname for reliable exit navigation when the destination differs only by query. Cover both the exact URL and the exit action in a browser test.