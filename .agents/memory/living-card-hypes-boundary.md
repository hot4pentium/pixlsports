---
name: Living card Hypes boundary
description: Why fan encouragement on the stable athlete invite has a separate lifecycle from media replies.
---

Keep encouragement sent from the stable living athlete card separate from replies attached to expiring Hype Card media. Preserve the owner's disabled setting when older page-update callers omit the Hypes field.

**Why:** Media replies are tied to revocable, expiring shares; treating them as card Hypes would make encouragement depend on unrelated media availability. Older update flows may not know about the Hypes setting, and a default applied during parsing would silently re-enable it.

**How to apply:** When changing public fan or owner flows, retain invite-scoped Hypes independently of one-off and original-page replies. On partial compatibility updates, missing Hypes settings mean unchanged, not enabled.