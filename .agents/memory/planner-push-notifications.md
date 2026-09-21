---
name: Planner push notifications
description: Durable design rules for schedule-based mobile web-push reminders.
---

Planner reminders must be evaluated server-side so they can arrive while Pixl Sports is closed. Store the subscribing device's IANA time zone and persist a delivery key for each project, event, reminder type, and event date so recurring job runs and schedule edits do not spam users.

**Why:** The existing dashboard stage reminder is client-only and cannot notify an absent user. Date-only schedule entries also need local-time evaluation rather than server-time assumptions.

**How to apply:** Keep reminder timing and deduplication in the API job, use the existing web-push sender and service worker, and treat schedule-date changes as new delivery keys.