---
name: Planner reminder preferences
description: The boundary between account-level alert choices and device-local event timing.
---

Reminder choices and the selected alert time zone belong to the signed-in account. One-hour reminders follow the event's saved time zone; day-of reminders use the selected account zone. Only older records without an account zone fall back to the most recently updated push subscription. Accounts without a saved reminder choice default to both alert types off; previously saved explicit choices remain intact.

**Why:** Users may have multiple devices in different zones, so a device's latest subscription cannot define the account's schedule. Event-local one-hour timing and account-local morning timing serve different purposes. Missing choices must not become opt-in when a scheduler starts.

**How to apply:** Keep consent and day-of zone in account preferences, retain the event zone for one-hour timing, and use a deterministically selected subscription zone only for legacy fallback. Never infer consent from app installation or a push subscription.