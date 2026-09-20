---
name: Offline installed editor
description: Requirements for keeping the installed Hype Card editor usable without a network or account session.
---

The standalone Hype Card route must remain available without authentication, while cloud-project routes may require an account. Device media and draft state must become durable before any network request begins.

**Why:** An auth gate prevented installed users from reaching otherwise-local functionality, and first-load browser requests can occur before a service worker controls the page.

**How to apply:** Keep core create, edit, preview, persistence, and export paths device-local. Production builds must inject all emitted app-shell assets into the service-worker precache; cloud sync should run only after local persistence and remain retryable.