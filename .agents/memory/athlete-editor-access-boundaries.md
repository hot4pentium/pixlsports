---
name: Athlete editor access boundaries
description: Product ownership, role, and persistence rules for athlete editing of the existing Showcase HYPE Card and kit.
---

Use a separate, limited athlete sign-in for card and kit editing. An athlete may edit only the parent-selected HYPE Card project and that linked athlete's cosmetic soccer kit. The parent can edit the same kit, including for a younger athlete, and retains athlete-page publishing, visibility, privacy, sharing, invitation, and account controls. Keep public/shared Locker routes and the parent-focused dashboard unchanged.

New athlete invitations should link to the HYPE Card already shown in the Showcase instead of requiring the owner to create a separate card. Preserve existing project-based invitations as a legacy path.

Revocation must block the athlete identity from parent-only APIs, even if the athlete still has a valid Clerk session. Preserve the access record independently of its athlete invite or project so deleting either cannot erase the revocation marker.

**Why:** The user chose athlete editing as a limited delegation, not a transfer of ownership or parent account role, and explicitly said parents should also be able to edit in case the athlete is too young. The user also clarified that the Showcase already contains the HYPE Card.

**How to apply:** Keep authorization server-side and scope card edits to the existing Showcase card and kit cosmetics to its linked athlete. Keep older project-based invitations usable. Both kit editors must follow existing milestone gates. Treat the athlete interface as a narrow route set, not a general supporter account.
