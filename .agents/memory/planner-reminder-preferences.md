---
name: Planner reminder preferences
description: The boundary between account-level alert choices and device-local event timing.
---

Reminder choices belong to the signed-in account, while event times are interpreted using the time zone saved with the active push subscription. Existing accounts default to the one-hour reminder enabled and the day-of reminder disabled.

**Why:** Users expect their choice of alert lead time to survive refreshes and account sessions, but a calendar event still needs the device’s local zone for correct daylight-saving and morning-of timing.

**How to apply:** Add future reminder types to the account preference contract and keep time-zone capture/update in the push subscription flow. Do not store alert choices only on an individual browser subscription.