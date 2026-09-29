---
name: Private dashboard offline authority
description: Safety boundaries for restoring the signed-in dashboard without a network.
---

Private dashboard snapshots are device conveniences, not server authority. Keep them account-scoped and age-bounded. Known paused, cancelled, or deletion-pending states remain blocked offline. When online, briefly wait for fresh lifecycle status before falling back to a saved active status on a weak connection.

**Why:** Offline access must not let stale cached permissions, lifecycle, quota, or ownership claims silently replace current server decisions, and private data must not cross an account change.

**How to apply:** Persist only the data needed to restore local work, never service-worker-cache authenticated API responses, keep offline mutations explicitly pending until acknowledged, and remove the previous account's private device data on sign-out or account switching.