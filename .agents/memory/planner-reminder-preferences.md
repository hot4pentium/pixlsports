---
name: Planner reminder preferences
description: The boundary between account-level alert choices and device-local event timing.
---

Reminder choices belong to the signed-in account, while event times are interpreted using the time zone saved with the active push subscription. Accounts without a saved reminder choice should default to both one-hour and day-of alerts off; previously saved explicit choices remain intact.

**Why:** Users expect their choice of alert lead time to survive refreshes and account sessions, but a calendar event still needs the device’s local zone for correct daylight-saving and morning-of timing. The interface said automatic delivery was not yet active, so silently treating an absent choice as opt-in when a scheduler starts would be surprising.

**How to apply:** Add future reminder types to the account preference contract and keep time-zone capture/update in the push subscription flow. Do not store alert choices only on an individual browser subscription or infer consent from the presence of a push subscription.