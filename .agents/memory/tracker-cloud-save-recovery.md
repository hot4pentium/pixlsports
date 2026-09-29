---
name: Tracker cloud-save recovery
description: Recovery rules for locally saved tracker results when cloud sync fails or the server detects a revision conflict.
---

Completed tracker results are local-first. Persist retryable cloud failures under the signed-in account so a reload restores both the local result and a visible retry path; clear that state only after the server acknowledges a sync. Persist revision conflicts separately and block automatic retries until the user chooses which history to keep.

**Why:** In-memory recovery controls disappear on reload, while treating a revision conflict like a transport failure can overwrite newer cloud history.

**How to apply:** When changing completed-game saves, retry handling, or reload hydration, cover account isolation, acknowledgement timing, local-result retention, and conflict recovery as one end-to-end flow.