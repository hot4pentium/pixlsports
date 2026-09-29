---
name: Planner subscription time zones
description: Push reminder timing must not depend on an arbitrary subscription row when an account has multiple devices.
---

The most recently updated push subscription is only a legacy fallback when an account has no saved alert zone. New Event Card one-hour timing uses the event's saved zone, while day-of timing uses the account preference zone; arbitrary subscription-row order must not control either.

**Why:** Browsers and devices can leave multiple subscriptions behind, and their zones may differ from the account's choice or the event's local zone. A stale subscription with the wrong zone previously caused a reminder to be treated as already started.

**How to apply:** Prefer explicit account and event zones. Preserve deterministic subscription ordering only for compatibility fallback; if future features schedule per-device reminders, evaluate and deduplicate each device's delivery separately.