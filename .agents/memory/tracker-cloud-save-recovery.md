---
name: Tracker cloud-save recovery
description: Recovery rules for locally saved tracker results when cloud sync fails or the server detects a revision conflict.
---

Completed tracker results are local-first. Persist retryable cloud failures under the signed-in account so a reload restores both the local result and a visible retry path; clear that state only after the server acknowledges a sync. Persist revision conflicts separately and block automatic retries until the user chooses which history to keep.

**Why:** In-memory recovery controls disappear on reload, while treating a revision conflict like a transport failure can overwrite newer cloud history.

**How to apply:** When changing completed-game saves, retry handling, or reload hydration, cover account isolation, acknowledgement timing, local-result retention, and conflict recovery as one end-to-end flow.

Publish a completed game to the temporary supporter share only after its finalized tracker project is confirmed in the cloud. If that project save fails, keep the share pending; after recovery, publish the final state and let the HYPE Card read the recap from the owner-owned project. A failed final-share update must remain retryable.

**Why:** The HYPE Card reads durable summaries from the cloud tracker project, while finalizing the temporary share removes its live scoreboard. Publishing the share first can briefly leave the card with neither the live board nor the new recap.

**How to apply:** Sequence final project save before final share update. On retry, match pending final share games to finalized cloud games, and preserve an account-scoped retry path if either the share lookup or update fails.