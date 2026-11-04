---
name: Fan Base consent and privacy
description: Product boundaries for owner follower summaries and partial alert-preference updates.
---

Fan Base belongs on both owner dashboards below Game Record. It shows saved browser/device follows, optional self-entered names, and an anonymous count—not verified unique people or contact details. Fans do not need an account, a name, or alert permission. Turning off alerts or expiring a push subscription must not remove the saved follow.

**Why:** The user chose counts and optional names on both dashboards, without requiring fan identities or alert sign-up.

**How to apply:** Keep owner summaries private and limited to counts and volunteered names. Native access must use the verified account link and selected athlete, never an email match.

Partial preference updates must preserve omitted alert choices. Put initial defaults in creation contracts, not partial-update contracts.

**Why:** OpenAPI defaults become active Zod parsing defaults; a default on an omitted PATCH field can silently reset existing alert consent during a name-only update.

**How to apply:** Inspect generated parsers and verify a name-only update against an existing opted-in follow whenever changing these contracts.
