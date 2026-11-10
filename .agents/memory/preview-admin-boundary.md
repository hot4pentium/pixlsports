---
name: Preview administrator access
description: Keep Preview administrator access separate from production and limited to the explicitly configured verified owner.
---

Preview may allow administrator access for the explicitly configured, verified owner account; it must not enable administrators indiscriminately.

**Why:** The user approved administrator access in Preview after the production-only restriction hid the dashboard's administrator entry.

**How to apply:** Keep Preview and production identities and permissions separate. Require the configured verified email and a development Clerk tenant, retain auditing and revocation, and never copy production identities into development.
