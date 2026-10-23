---
name: Athlete editor access boundaries
description: Product ownership and access rules for athlete participation through the HYPE Card.
---

For dedicated athlete-only invitations, use a separate, limited sign-in for the parent-selected HYPE Card only. The athlete may edit that linked card and focused card content, but not publishing, visibility, privacy, sharing, invitation, or account controls. Keep those controls with the parent.

Existing Pixl Sports accounts may also be invited to edit a selected HYPE Card. They must explicitly accept using their matching verified email. Do not convert an existing account into an athlete-only identity, rewrite its role or profile, borrow the owner's plan, or lock its own account when card access is revoked. Dedicated athlete-only sign-ins retain their original restrictions.

**Why:** The user explicitly chose to allow invitations to existing accounts while preserving their own permissions and restricting the new grant to the invited card.

**How to apply:** Treat shared-card access as an additional grant, not an account role. Keep sign-up invitations and whole-identity athlete restrictions separate from existing-account invitations.

New athlete invitations should link to the HYPE Card already shown in the Showcase instead of requiring the owner to create a separate card. Preserve existing project-based invitations as a legacy path where needed for compatibility.

Retire the user-facing jersey, Soccer Kit, Athlete Locker, and gear-reward tools; do not delete existing kit or reward data as part of that retirement.

Revocation must block the athlete identity from parent-only APIs, even if the athlete still has a valid Clerk session. Preserve the access record independently of its athlete invite or project so deleting either cannot erase the revocation marker.

**Why:** The user chose athlete editing as a limited delegation, not a transfer of ownership or parent account role, and explicitly said parents should also be able to edit in case the athlete is too young. They now want the Showcase to retain its name but focus on the HYPE Card, with jersey and gear tools retired.

**How to apply:** Keep authorization server-side and scope athlete edits to the linked HYPE Card. Preserve parent controls and legacy invitation safety, but do not expose the retired kit or gear editors. Treat athlete access as a narrow card-editing role, not a general supporter account.
