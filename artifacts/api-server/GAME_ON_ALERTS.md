# Game On reminder runner

The API remains on Autoscale and does not poll for Game On reminders. The
scheduled caller makes a short authenticated HTTP request to the API; the API
keeps production database and VAPID access. No database or push-signing
credentials belong in the scheduled caller.

## Current status

- `runPlannerNotificationJob` performs one database-backed pass over eligible
  Game On Cards and sends due reminders.
- `POST /api/internal/jobs/game-on-alerts` rejects missing configuration,
  invalid or stale signatures, request bodies, query parameters, and reused
  nonces.
- `cloudflare-worker/worker.mjs` signs one request with Web Crypto. The active
  Wrangler configuration runs it every two minutes in UTC; the disabled
  configuration has no cron trigger for safe setup or pausing.
- No recurring schedule is deployed yet. The existing
  `run:game-on-alerts` command calls the database-backed job directly; do not
  run it against live subscriptions as a test because it can send real alerts.

## Activate the Cloudflare caller

1. Publish the API code and development schema change so the trigger endpoint
   and replay-protection table exist in production. Replit's Publish flow
   applies the production schema change; do not run a database push in
   production.
2. Add a randomly generated secret of at least 32 characters as
   `GAME_ON_ALERTS_TRIGGER_SECRET` in the API's Production Secrets.
3. Deploy `cloudflare-worker/wrangler.disabled.jsonc` first. It has no cron
   trigger and no public HTTP handler. In that Worker, configure two Cloudflare
   secrets: `GAME_ON_ALERTS_TRIGGER_SECRET` with the same value as the API, and
   `GAME_ON_ALERTS_TRIGGER_URL` with the published HTTPS API URL whose pathname
   is exactly `/api/internal/jobs/game-on-alerts`. Use the deployment's
   verified production URL, not a `.replit.dev` preview URL. Do not put the
   secret value in source or Wrangler configuration. Cloudflare's `secret put`
   command can deploy a new Worker version, so use the disabled configuration
   for the initial deploy and **both** secret uploads. Confirm in Cloudflare
   that the deployed Worker has zero Cron Triggers before continuing.
4. Deploy `cloudflare-worker/wrangler.jsonc` to enable the UTC
   `*/2 * * * *` Cron Trigger. This begins real reminder checks for opted-in
   supporters. Monitor the Cloudflare scheduled-run status and API logs for
   non-2xx responses and job errors; the Worker logs only HTTP status, not
   event details or push credentials.
5. To pause calls without changing the Autoscale API, deploy
   `cloudflare-worker/wrangler.disabled.jsonc` again.

From the repository root, pass the intended configuration explicitly to every
Wrangler command:

```sh
wrangler deploy --config artifacts/api-server/cloudflare-worker/wrangler.disabled.jsonc
wrangler secret put GAME_ON_ALERTS_TRIGGER_SECRET --config artifacts/api-server/cloudflare-worker/wrangler.disabled.jsonc
wrangler secret put GAME_ON_ALERTS_TRIGGER_URL --config artifacts/api-server/cloudflare-worker/wrangler.disabled.jsonc
# Only after the API, production schema, and both Worker secrets are ready:
wrangler deploy --config artifacts/api-server/cloudflare-worker/wrangler.jsonc
```

The `secret put` commands should receive their values through a secure prompt
or secret environment variable, never as command-line arguments or committed
files. Before the final deploy, confirm the production `internal_job_requests`
table exists and the API and Worker use the same signing secret.

Replit Scheduled Deployments have a minimum interval of one hour, which is too
slow for timely one-hour reminders. The API stays on Autoscale. The Cloudflare
Worker receives only the endpoint and request-signing secret, never
`DATABASE_URL`, VAPID keys, or push subscription data.

For a different external scheduler that can run Node, the one-shot
`gameOnAlertsTriggerCli` is available after `pnpm --filter @workspace/api-server
run build`; invoke it with `pnpm --filter @workspace/api-server run
run:game-on-alerts-trigger`. Do not run the direct database-backed
`run:game-on-alerts` command in a scheduled caller.

The reminder job re-reads the current Game On Card on every pass. That lets
edits, final status, and removed events affect eligibility without creating
one long-lived timer per event. Durable delivery records prevent duplicate
push attempts across repeated runner calls.