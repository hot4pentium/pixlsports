---
name: Cached startup browser timing
description: How installed-startup browser checks should separate app readiness from development-server startup.
---

Startup timing checks should prove cached content appears before a deliberately delayed refresh, and report the relationship between those events rather than relying on a tight absolute time from a Vite dev server.

**Why:** Dev-server module loading can vary by several seconds even when the cached application path is nonblocking; an absolute threshold made the regression test measure the harness instead of the feature.

**How to apply:** Add an explicit delayed-response marker and assert cached content is visible while that marker is unresolved. Keep any absolute budget conservative and secondary.