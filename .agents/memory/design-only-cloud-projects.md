---
name: Paid cloud project media
description: Product policy for private project media, paid eligibility, and design-only saves.
---

Only accounts with an active entitlement recorded by the signed billing webhook may persist private Hype Card photos, logos, posters, and locally prepared video renditions. Guest and unpaid saves remain design-only.

Video storage uses separate preview and download renditions. Cloud project listings use static images, preview video transfers only after Play, and download-quality video transfers only after Download. Original source videos and permanent rendered exports are not stored.

**Why:** This provides cross-device paid storage while limiting privacy exposure, storage use, and unnecessary video transfer. Client-selected account modes are not payment proof.

**How to apply:** Gate upload claims with the server-side entitlement ledger, enforce the shared quota from verified object metadata, keep objects private and owner-scoped, and preserve framing while stripping embedded media from project JSON.