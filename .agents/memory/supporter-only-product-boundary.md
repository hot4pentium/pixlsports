---
name: Supporter-only product boundary
description: Product decision removing team-management roles and infrastructure while preserving supporter profiles and tools.
---

Pixl Sports is a supporter-only product for fans and parents, centered on celebrating an individual athlete. The primary Studio tab bar contains only Supporter Hub and Player Showcase; keep profile, gear, HYPE Card, stats, and account actions within their relevant pages. The full Stat Tracker is the only tracker; do not offer quick-result or inline tracking alternatives. Meetings are not part of the product flow. Do not reintroduce role selection, roster management, private team-calendar connections, or related APIs.

Legacy non-fan account roles should normalize and persist as `fan`. Previously saved Hype Card messages should migrate into the current generic message field. Retired private calendar URLs intentionally return 404 rather than continuing a compatibility service.

**Why:** The user chose to center the experience on parents celebrating one athlete, remove meetings, keep team stats only as an advanced option, and simplify player management to two primary tabs.

**How to apply:** Evaluate future navigation, contracts, database changes, and product proposals against the parent/athlete journey. Keep the top-level tabs limited to Supporter Hub and Player Showcase. Route Event Card tracking actions to the full tracker, preserving event context and saved sessions. Do not add meeting flows. Treat team-management features as outside the product unless the user explicitly reverses this decision.

**Why (tracker scope):** The user said, “The Full stat tracker should be the only stat tracker.”