---
name: Game On scheduled caller
description: Approved provider and activation boundary for recurring Game On reminder checks.
---

Keep the app/API on Autoscale and use a Cloudflare Workers Cron Trigger for the two-minute Game On reminder caller, without enabling paid add-ons.

**Why:** Replit Scheduled Deployments have a one-hour minimum interval, too slow for the requested reminders. The user approved Cloudflare after discussing the expected Free-plan usage, but did not approve a paid upgrade.

**How to apply:** Do not substitute an hourly scheduler or enable a live Cron Trigger before the production API, replay-protection schema, and matching signing secrets are ready. Keep the caller limited to a signed request; database and push credentials remain in the API.