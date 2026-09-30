---
name: Private dashboard offline authority
description: Safety boundaries for restoring the signed-in dashboard without a network.
---

Private dashboard snapshots are device conveniences, not server authority. Keep them account-scoped and age-bounded. Known paused, cancelled, deletion-pending, and not-provisioned states remain blocked offline. When online, briefly wait for fresh lifecycle status before falling back to a saved active status on a weak connection. A confirmed missing account clears its private browser data and query cache.

Initial setup is intentionally limited to identities created within seven days that have no server-owned provisioning marker or legacy profile metadata. After setup succeeds, verify the lifecycle has become active before saving the profile.

**Why:** Offline access must not let stale cached permissions, lifecycle, quota, or ownership claims silently replace current server decisions, and private data must not cross an account change. Deleting an account row removes the lifecycle record, so a missing row must not be treated as active; a narrow first-setup signal prevents deleted identities from recreating access.

**How to apply:** Persist only the data needed to restore local work, never service-worker-cache authenticated API responses, retry ordinary pending tracker saves when connectivity returns, keep revision conflicts under explicit user control, and remove private device data on sign-out, account switching, or a server-confirmed missing account. Keep the seven-day limit consistent between server enforcement and setup UI until a durable account tombstone or registry can replace it.