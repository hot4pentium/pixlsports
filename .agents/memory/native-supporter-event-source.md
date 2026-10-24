---
name: Native supporter event source
description: Data boundary for the initial native iPhone Supporter Home.
---

The first native Supporter Home reads published Event Cards through a supporter’s saved public athlete-page link. It does not read the signed-in supporter’s private account schedule. Do not call private project APIs from the unauthenticated native app.

**Why:** The starter Xcode project had no sign-in or native API client, while the supporter’s private schedule requires an authenticated account. The public athlete-page feed provides real event data without inventing a session or exposing credentials.

**How to apply:** Preserve the public-link flow until a native sign-in/session flow is implemented. When private account schedules are added, use the authenticated API and keep the loading, empty, and recoverable error states.
