---
name: Supporter-only product boundary
description: Product decision removing team-management roles and infrastructure while preserving supporter profiles and tools.
---

Pixl Sports is a supporter-only product for fans and parents. Keep supporter profiles and the schedule, checklist, stat tracker, and Hype Card tools, but do not reintroduce role selection, roster management, private team-calendar connections, or related APIs.

Legacy non-fan account roles should normalize and persist as `fan`. Previously saved Hype Card messages should migrate into the current generic message field. Retired private calendar URLs intentionally return 404 rather than continuing a compatibility service.

**Why:** The user explicitly chose complete removal of the team-management product path while clarifying that profile terminology and supporter profile data must remain.

**How to apply:** Evaluate future navigation, contracts, database changes, and product proposals against the fan/parent journey. Treat team-management features as outside the product unless the user explicitly reverses this decision.