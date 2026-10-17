---
name: Athlete editor access boundaries
description: Product ownership, role, and persistence rules for a separate athlete HYPE Card editor sign-in.
---

Use a separate, limited athlete sign-in for card editing. An athlete may edit only the parent-selected HYPE Card project; the parent retains athlete-page publishing, visibility, privacy, and sharing controls. Keep public/shared Locker routes and the parent-focused dashboard unchanged.

Revocation must block the athlete identity from parent-only APIs, even if the athlete still has a valid Clerk session. Preserve the access record independently of its athlete invite or project so deleting either cannot erase the revocation marker.

**Why:** The user chose athlete editing as a limited delegation, not a transfer of ownership or parent account role.

**How to apply:** Keep authorization server-side and scope project/media reads and writes to the one linked card; treat the athlete interface as a narrow route set, not a general supporter account.
