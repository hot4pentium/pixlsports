---
name: Athlete editor access boundaries
description: Product ownership and access rules for athlete participation through the HYPE Card.
---

Use a separate, limited athlete sign-in for the parent-selected HYPE Card only. The athlete may edit that linked card and focused card content, but not publishing, visibility, privacy, sharing, invitation, or account controls. Keep those controls with the parent.

New athlete invitations should link to the HYPE Card already shown in the Showcase instead of requiring the owner to create a separate card. Preserve existing project-based invitations as a legacy path where needed for compatibility.

Retire the user-facing jersey, Soccer Kit, Athlete Locker, and gear-reward tools; do not delete existing kit or reward data as part of that retirement.

Revocation must block the athlete identity from parent-only APIs, even if the athlete still has a valid Clerk session. Preserve the access record independently of its athlete invite or project so deleting either cannot erase the revocation marker.

**Why:** The user chose athlete editing as a limited delegation, not a transfer of ownership or parent account role, and explicitly said parents should also be able to edit in case the athlete is too young. They now want the Showcase to retain its name but focus on the HYPE Card, with jersey and gear tools retired.

**How to apply:** Keep authorization server-side and scope athlete edits to the linked HYPE Card. Preserve parent controls and legacy invitation safety, but do not expose the retired kit or gear editors. Treat athlete access as a narrow card-editing role, not a general supporter account.
