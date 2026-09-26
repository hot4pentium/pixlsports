---
name: Versioned offline HTML
description: Why the installed app's cached HTML must advance with a full service-worker update.
---

For installed launches, serve the HTML shell from the current service worker's cache. Do not overwrite it with a network navigation response while that worker remains active; advance the shell through a new versioned worker install that also precaches its matching assets.

**Why:** A newly published HTML response can reference JavaScript and CSS that the old worker never precached. Saving that HTML into the old cache makes the next offline launch fail even though the shell appears cached.

**How to apply:** When changing navigation or update logic, check that the shell and asset version rotate together, that private API responses stay uncached, and that unrelated artifacts sharing the origin are not served this app's shell.