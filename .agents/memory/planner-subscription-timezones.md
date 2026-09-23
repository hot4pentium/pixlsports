---
name: Planner subscription time zones
description: Push reminder timing must not depend on an arbitrary subscription row when an account has multiple devices.
---

The planner should prefer the most recently updated push subscription when selecting an account's active reminder time zone; arbitrary row order can select a stale UTC subscription and make a local event appear already started.

**Why:** Browsers and devices can leave multiple push subscriptions behind. A stale subscription with the wrong time zone caused a noon Eastern meeting to miss its one-hour reminder.

**How to apply:** Preserve deterministic subscription ordering in planner notification queries. For full multi-device correctness, evaluate and deduplicate reminders per subscription rather than once per account.