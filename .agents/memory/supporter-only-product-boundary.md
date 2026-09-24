---
name: Supporter-only product boundary
description: Product decision removing team-management roles and infrastructure while preserving supporter profiles and tools.
---

Pixl Sports is a supporter-only product for fans and parents, centered on celebrating an individual athlete. Default stats capture to that athlete; keep the full team tracker only as an advanced secondary tool. Meetings are not part of the product flow. Do not reintroduce role selection, roster management, private team-calendar connections, or related APIs.

Legacy non-fan account roles should normalize and persist as `fan`. Previously saved Hype Card messages should migrate into the current generic message field. Retired private calendar URLs intentionally return 404 rather than continuing a compatibility service.

**Why:** The user chose to center the experience on parents celebrating one athlete, remove meetings, and keep team stats only as an advanced option, while maintaining the supporter-only boundary.

**How to apply:** Evaluate future navigation, contracts, database changes, and product proposals against the parent/athlete journey. Do not add meeting flows or make team stats the default. Treat team-management features as outside the product unless the user explicitly reverses this decision.