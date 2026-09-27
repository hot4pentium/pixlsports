---
name: Season correction reconciliation
description: Why season review uses cloud authority for shared games and blocks edits on divergent device histories.
---

Season review treats the account copy as authoritative for games present both in cloud and on a device. Device-only games remain visible. A correction to a final must not submit an unrelated stale device version of another game; if the two copies differ, require tracker-history reconciliation before saving. The normal tracker remains local-first for in-progress plays, but must preserve a newer finalized cloud correction when merging the same game ID before its next upload.

**Why:** The live tracker is local-first and its normal merge gives device history precedence for identical game IDs. Reusing that merge during a retrospective cloud correction could silently revert a newer game or an earlier correction. Cloud revision checking alone protects only concurrent writes, not a stale local payload submitted with a valid current revision.

**How to apply:** Fetch current account history immediately before a correction, keep the editor open on conflicts, and update the account copy before the device copy. Before a normal tracker upload, ensure account history has loaded and reconcile any newer finalized cloud corrections without replacing live local play events.