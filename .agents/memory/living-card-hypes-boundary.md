---
name: Living card Shoutouts boundary
description: Why Shoutouts on the stable athlete invite stay separate from media replies and retain legacy identifiers.
---

Keep encouragement sent from the stable living athlete card separate from replies attached to expiring Hype Card media. Call the former Fan Shoutouts in user-facing copy; retain legacy Hypes-named identifiers for existing records and deep links. The owner dashboard may show both in one activity preview, but label their sources and keep their storage, read state, and deletion paths separate. Preserve the owner's disabled setting when older page-update callers omit the Hypes field.

**Why:** Media replies are tied to revocable, expiring shares; treating them as card Shoutouts would make encouragement depend on unrelated media availability. A saved message once appeared missing because the dashboard only loaded media replies. Older update flows may not know about the Hypes setting, and a default applied during parsing would silently re-enable it. Renaming persisted identifiers or link anchors for a copy change would break older shares and alerts.

**How to apply:** When changing public fan or owner flows, retain invite-scoped messages independently of one-off and original-page replies. Dashboard activity can query and sort both sources for display, but must not equate their lifecycles. Keep legacy message keys and deep-link targets unless performing a deliberate migration; on partial compatibility updates, missing Hypes settings mean unchanged, not enabled.