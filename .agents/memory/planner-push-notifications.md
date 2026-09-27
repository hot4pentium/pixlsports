---
name: Planner push notifications
description: Durable design rules for schedule-based mobile web-push reminders.
---

Planner reminders must be evaluated server-side so they can arrive while Pixl Sports is closed. Store the subscribing device's IANA time zone and persist a delivery key for each card, event, reminder type, and event date so recurring job runs and schedule edits do not spam users. Keep a bounded post-start recovery window for an active event.

**Why:** A dashboard-only reminder cannot notify an absent user. Date-only schedule entries need local-time evaluation rather than server-time assumptions. An autoscaled API can be asleep during the one-hour window, so checks must run independently and tolerate delayed execution.

**How to apply:** Keep reminder timing and deduplication in the shared server job, use the existing web-push sender and service worker, and treat card-date changes as new delivery keys. Use a distinct active-window notification type for a late catch-up rather than relabeling it as a future reminder.

Replit Routines have a documented one-hour minimum; do not conflate them with Scheduled Deployments, whose guide supports cron expressions without documenting a minimum interval.

**Why:** Documentation search summaries conflated these two products and incorrectly ruled out a frequent Scheduled Deployment. An hourly run would miss the intended one-hour-before moment for arbitrary event times.

**How to apply:** Recheck current deployment docs and verify the desired cron expression in publishing controls before promising cadence. Obtain owner approval after the actual pricing is displayed and before any hosting-cost change.

The existing project's Publishing → Adjust settings screen offers “Add deployment secret,” not a way to add a second Scheduled Deployment beside Autoscale. Do not direct the owner to that control for a second deployment.

**Why:** The platform's multi-artifact documentation says a project's artifacts publish together, while search summaries gave contradictory claims about independent deployment types. The actual screen did not support the proposed path.

**How to apply:** Treat same-project concurrent Scheduled + Autoscale hosting as unverified until a supported UI/API path is observed. Consider a separate scheduled project or a secured frequent external trigger only after checking shared-data access and obtaining approval for the changed approach and cost.