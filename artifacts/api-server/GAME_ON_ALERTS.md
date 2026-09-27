# Game On alert worker (not published yet)

The API remains on Autoscale. It no longer polls for Game On alerts; the
standalone worker makes one database-backed pass over all subscribed accounts
and exits. Do not run it manually against live data to test it: it can send
real push notifications.

For the proposed separate Replit **Scheduled Deployment**:

- Schedule: `*/2 * * * *` (every two minutes), time zone UTC.
- Build command: `pnpm --filter @workspace/api-server run build`
- Run command: `node --enable-source-maps artifacts/api-server/dist/gameOnAlertsCli.mjs`
- Share the production database and VAPID configuration with the API.
- Keep the existing main deployment on Autoscale; do not replace it.

**Publishing gate:** Replit documents cron expressions for Scheduled
Deployments, but not their minimum interval. Confirm the publishing controls
accept this exact schedule and display the actual price before creating or
publishing the scheduled deployment. Stop and ask the owner to review both;
do not switch the API to a Reserved VM. A two-minute cadence targets delivery
within five minutes during ordinary operation. A delayed run sends still-
relevant due reminders; an outage longer than five minutes cannot satisfy
the original timing window retroactively.