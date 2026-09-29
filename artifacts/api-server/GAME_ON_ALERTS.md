# Game On reminder runner — cron-job.org

The Pixl Sports API remains on Replit Autoscale. It does not run an in-process
timer: cron-job.org wakes the public API with a small authenticated request
every five minutes. The API alone accesses its database, push subscriptions
and VAPID credentials. Only the scheduler token is shared with cron-job.org.

## Status and limits

- The published Autoscale deployment is receiving successful five-minute
  checks from its configured cron caller. Do not run a production POST as a
  test: it may send real phone alerts. Use the notification configuration's
  scheduled-delivery status to confirm that a recent successful check is
  still present.
- Reminders are for opted-in **account owners** with a current push
  subscription. An absent one-hour preference is off. A published Hype Card
  does not disable the owner's one-hour prompt. Followers are never notified
  by this job. A successful one-hour prompt suppresses the later capture-open
  fallback; date-only events cannot have a one-hour prompt.
- New Game On events retain an editable IANA event time zone. Older cards
  without one use the account's selected alert time zone, then the most
  recently saved subscription time zone for compatibility (or UTC if both
  are missing/invalid). One-hour reminders follow the event's saved zone;
  day-of reminders are scheduled for 7:00 a.m. in the selected alert zone.
  UTC database due times account for daylight-saving changes. Nonexistent
  local times at a DST jump are not scheduled; an ambiguous repeated local
  time uses its first occurrence.
- Five-minute polling can deliver a reminder several minutes after its due
  time. If a check is missed, later checks pick up overdue reminders while
  they remain relevant; after the event starts, the capture-open fallback can
  replace a missed one-hour prompt for up to three hours. Old alerts do not
  arrive indefinitely late.
- Push-service acceptance is not proof that a phone displayed a notification.
  Known rejections may be retried; transport timeouts have an uncertain
  outcome and are held for review rather than risking duplicate pushes.
- cron-job.org closes requests after 30 seconds. The API claims a bounded
  batch (two reminders, up to two devices each), caps individual push calls
  at eight seconds, and defers delivery if earlier work uses its start
  budget. At high volume, later checks process remaining rows. A stalled
  database or Autoscale cold start is outside the in-handler budget, so
  monitor actual duration and backlog before and after activation.
  A reminder stops after twelve claimed attempts or its relevance window,
  whichever comes first.

## Configure cron-job.org (leave disabled until owner approval)

1. Publish the updated existing Replit app/API. Keep its deployment type
   **Autoscale**. Replit's Publish flow applies the development database
   schema change to its managed production database; do not run a custom
   production migration or copy development data into production.
2. Add a unique random token of at least 32 characters to the API's
   **Production Secrets** as `GAME_ON_ALERTS_CRON_TOKEN`. Do not place it in
   source, a query string, or chat. Ensure production web push is configured
   (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) and owners have
   explicitly enabled alerts and their desired one-hour/day-of preference.
3. Create an **initially disabled** cron-job.org job with these settings.
   The verified public Autoscale URL currently is:

   | Setting | Value |
   | --- | --- |
   | URL | `https://league-matrix-creative-studio.replit.app/api/internal/jobs/game-on-alerts/cron` |
   | Method | `POST` |
   | Schedule | Every 5 minutes (`*/5 * * * *`) |
   | Body and URL parameters | None |
   | `x-game-on-alerts-timestamp` header | `%cjo:unixtime%` |
   | `x-game-on-alerts-nonce` header | `%cjo:uuid4%` |
   | `x-game-on-alerts-token` header | The value saved as `GAME_ON_ALERTS_CRON_TOKEN` in Production Secrets |

   cron-job.org substitutes its [Unix timestamp and UUID
   variables](https://docs.cron-job.org/creating-cron-jobs.html) on every
   execution. These values must be **headers**, not URL parameters. If the
   published domain changes, obtain the actual new published HTTPS URL rather
   than using a `.replit.dev` preview link. The deployment must be public or
   have separately authorized external access for cron-job.org.
4. Confirm the new production schema exists, the API has the production
   token, and no Cloudflare or other Game On scheduler is enabled. Obtain
   owner approval before enabling this job; even the first call can send
   real pushes. Enable cron-job.org failure notifications and inspect its
   execution history and API logs after enabling. Disable the job to pause
   without changing the Autoscale deployment.

## Responses and monitoring

The authenticated `POST` returns HTTP `200` with aggregate counts, for example
`{"success":true,"processed":0,"sent":0,"failed":0,"pending":0,"due":0,"uncertain":0,"synced":0,"syncErrors":0,"deadlineDeferred":false,"durationMs":0,"moreDue":false,"lastSuccessAt":"..."}`.
A check with zero
eligible reminders still returns `200`; it does not indicate that a phone
displayed an alert. HTTP `400` means a body/query was provided, `401` means
the token, timestamp or nonce is invalid/stale, `409` means the nonce was
reused, `503` means the API token is not configured, and `500` means the
check failed. Treat non-2xx responses, `syncErrors > 0`,
`deadlineDeferred: true`, repeated `moreDue: true`, and a growing `due`
count as operational failures; inspect server logs for the failing phase and
aggregate counts, never event names, endpoints or credentials.

The same URL accepts a protected read-only `GET` with the same three headers
and a **fresh nonce**. It reports the last completed check and aggregate
pending/sent/failed counts without sending a push. Do not use `GET` as the
cron-job.org method: only `POST` processes reminders. The Replit API health
route alone does not prove the reminder job has run.

The public notification configuration response reports scheduled delivery as
active only when push is configured, a valid cron token is present, and the
server recorded a successful reminder check within the last 15 minutes. This
keeps the settings page from treating saved preferences or an installed app as
proof that a scheduler is currently running.

## Other callers

Cloudflare Worker and the signed Node trigger are legacy prepared
alternatives, not the chosen schedule. Leave their triggers disabled and
never activate both schedulers. The `run:game-on-alerts` CLI uses the same
database-backed bounded job but is **not** for production test calls.