---
name: Tracker cloud-save recovery
description: Recovery rules for locally saved tracker results when cloud sync fails or the server detects a revision conflict.
---

Completed tracker results are local-first. Persist retryable cloud failures under the signed-in account so a reload restores both the local result and a visible retry path; clear that state only after the server acknowledges a sync. For whole-project saves, keep revision conflicts separate and require an explicit history choice before replacing a saved project.

**Why:** In-memory recovery controls disappear on reload, while treating a revision conflict like a transport failure can overwrite newer cloud history.

**How to apply:** When changing completed-game saves, retry handling, or reload hydration, cover account isolation, acknowledgement timing, local-result retention, and conflict recovery as one end-to-end flow.

For native Event Card tracker taps, queue each action durably per account and Event Card, then send commands serially. Keep an attempted command's ID, payload, and revision unchanged; replay that exact command after uncertain responses and use server receipts to confirm accepted actions. On a recoverable revision conflict, let the owner keep tracking locally, but rebase only never-sent actions after confirming the same account link and live game. Preserve the local queue and explain why sync is paused; never offer a destructive saved-version choice for tracker data. A changed link, different game, or finalized game blocks new writes and syncs without clearing the queue. Keep Prep's conflict flow separate.

**Why:** Game-day tracking cannot stop during a recoverable network or revision conflict, while replaying a request with an uncertain outcome must not duplicate an event or send it to a different game.

**How to apply:** When changing native Event Card tracking or its outbox tests, cover relaunch, exact attempted-command replay, ordered rebasing of unsent actions, same-game validation, incompatible-state preservation, and the unchanged Prep flow.

Cached workspaces may restore the local tracker display, but must not establish that the server changed or finalized a game, or acknowledge queued actions. Those reconciliation decisions require a fresh server response; a failed refresh must leave the local projection and pending actions intact.

**Why:** A transport fallback can return an older cached game (or no game), which is not evidence that the live server replaced the game being scored.

**How to apply:** Keep display restoration separate from authoritative tracker reconciliation, including offline resume and retry paths.

Publish a completed game to the temporary supporter share only after its finalized tracker project is confirmed in the cloud. If that project save fails, keep the share pending; after recovery, publish the final state and let the HYPE Card read the recap from the owner-owned project. A failed final-share update must remain retryable.

**Why:** The HYPE Card reads durable summaries from the cloud tracker project, while finalizing the temporary share removes its live scoreboard. Publishing the share first can briefly leave the card with neither the live board nor the new recap.

**How to apply:** Sequence final project save before final share update. On retry, match pending final share games to finalized cloud games, and preserve an account-scoped retry path if either the share lookup or update fails.