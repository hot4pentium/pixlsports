# Game On reminder runner

The API remains on Autoscale and does not poll for Game On reminders. The
scheduled caller makes a short authenticated HTTP request to the API; the API
keeps production database and VAPID access. No database or push-signing
credentials belong in the scheduled caller.

## Current status

- `runPlannerNotificationJob` performs one database-backed pass over eligible
  Game On Cards and sends due reminders.
- `gameOnAlertsTriggerCli` signs and sends one request to the API, then exits.
- `POST /api/internal/jobs/game-on-alerts` rejects missing configuration,
  invalid or stale signatures, request bodies, query parameters, and reused
  nonces.
- No recurring schedule is configured by this code. The existing
  `run:game-on-alerts` command calls the database-backed job directly; do not
  run it against live subscriptions as a test because it can send real alerts.

## Configure the caller

1. Publish the API code and development schema change so the trigger endpoint
   and replay-protection table exist in production.
2. Add a randomly generated secret of at least 32 characters as
   `GAME_ON_ALERTS_TRIGGER_SECRET` in the API's Production Secrets.
3. Configure the scheduled caller with that same secret and
   `GAME_ON_ALERTS_TRIGGER_URL`, set to the published API endpoint ending in
   `/api/internal/jobs/game-on-alerts`. Do not use a development URL.
4. Build with `pnpm --filter @workspace/api-server run build`.
5. Run
   `pnpm --filter @workspace/api-server run run:game-on-alerts-trigger`.
   This caller needs only the endpoint URL and trigger secret; it must not
   receive `DATABASE_URL`, VAPID keys, or push subscription data.
6. Replit Scheduled Deployments have a minimum interval of one hour, which is
   too slow for timely one-hour reminders. Use an owner-approved external
   scheduler that can run this CLI or an equivalent signer every two minutes in
   UTC (`*/2 * * * *`). Do not enable the recurring caller until its secret,
   endpoint, and failure reporting are configured. Keep the main API on
   Autoscale.

The reminder job re-reads the current Game On Card on every pass. That lets
edits, final status, and removed events affect eligibility without creating
one long-lived timer per event. Durable delivery records prevent duplicate
push attempts across repeated runner calls.