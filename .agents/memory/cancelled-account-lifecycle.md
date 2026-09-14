---
name: Cancelled account lifecycle
description: Rules for safe cancellation, recovery, and retryable permanent deletion.
---

Treat account lifecycle as a strict state machine. Cancellation only moves an active account to cancelled. Reactivation only moves an unexpired cancelled account to active through one conditional database update. Once cleanup claims an account as deletion-pending, user actions never move it backward.

**Why:** Separate read-then-update operations allowed deadline races, and repeated cancellation could reset an expired account's retention window or interfere with a purge claim.

**How to apply:** Make every future lifecycle or entitlement transition conditional on the expected current state and deadline. Keep cleanup retry-safe across object storage, local database deletion, identity-provider deletion, and final lifecycle-row removal.