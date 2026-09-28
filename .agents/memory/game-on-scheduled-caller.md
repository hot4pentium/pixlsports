---
name: Game On scheduled caller
description: Approved provider and activation boundary for recurring Game On reminder checks.
---

Keep the app/API on Autoscale and use only one free two-minute Game On reminder caller. Cloudflare Workers Cron Trigger was initially approved; cron-job.org was later prepared as an alternative. Do not enable both.

**Why:** Replit Scheduled Deployments have a one-hour minimum interval, too slow for the requested reminders. The user approved Cloudflare after discussing expected Free-plan usage, then explored cron-job.org for the owner alert. They did not approve a paid upgrade, and two callers would repeat work.

**How to apply:** Do not substitute an hourly scheduler or enable a live caller before the production API, replay-protection schema, matching secret, and request-duration limit are ready. Cloudflare uses a signed request; cron-job.org uses its separate production bearer header. Database and push credentials remain in the API.