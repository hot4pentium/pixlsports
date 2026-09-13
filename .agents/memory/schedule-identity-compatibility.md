---
name: Schedule identity compatibility
description: Compatibility boundary for schedule identity in local drafts and public parent share snapshots.
---

New schedule drafts should model the identity as separate team name and season values. Keep the public share API field names compatible until a deliberate migration is planned: send the team name through the legacy headline field and the season through the legacy team-season field for new snapshots, while continuing to render older combined values unchanged.

**Why:** Existing local drafts and parent links may contain combined identity text, and changing the persisted/API shape immediately would make those schedules unreadable or require an unnecessary migration.

**How to apply:** When extending schedule identity, preserve legacy read normalization and keep old share snapshots renderable; only change the API/database contract as a separate migration with explicit backward compatibility.