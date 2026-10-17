---
name: Athlete editor access boundaries
description: Product ownership, role, and persistence rules for a separate athlete HYPE Card and cosmetic kit editor sign-in.
---

Use a separate, limited athlete sign-in for card and kit editing. An athlete may edit only the parent-selected HYPE Card project and that linked athlete's cosmetic soccer kit. The parent can edit the same kit, including for a younger athlete, and retains athlete-page publishing, visibility, privacy, sharing, invitation, and account controls. Keep public/shared Locker routes and the parent-focused dashboard unchanged.

Revocation must block the athlete identity from parent-only APIs, even if the athlete still has a valid Clerk session. Preserve the access record independently of its athlete invite or project so deleting either cannot erase the revocation marker.

**Why:** The user chose athlete editing as a limited delegation, not a transfer of ownership or parent account role, and explicitly said parents should also be able to edit in case the athlete is too young.

**How to apply:** Keep authorization server-side and scope project/media reads and writes to the one linked card and kit cosmetics to its linked athlete. Both kit editors must follow existing milestone gates. Treat the athlete interface as a narrow route set, not a general supporter account.
