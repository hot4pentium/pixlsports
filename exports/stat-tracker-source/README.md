# Pixl Sports Stat Tracker — source handoff

This is a focused source snapshot of the Stat Tracker in Pixl Sports Studio. It is a starting point for an extension project, not a standalone app or a drop-in package. The UI is integrated with Pixl authentication, project storage, generated API clients, schedules, supporter profiles, and shared design components.

## What the tracker does

- Records live games and per-play events for baseball, basketball, football, soccer, softball, and volleyball.
- Tracks team and athlete attribution separately, with sport-specific stats and game reports.
- Saves active and completed game data locally first, then syncs completed history to the signed-in account's cloud project.
- Preserves recoverable cloud-save failures across reloads and blocks automatic overwrite when local and cloud histories conflict.
- Supports season review and correction of finalized game stats.
- Supports temporary live sharing to a public spectator page, with owner checks, expiring/revocable shares, revision checks, and live updates.
- Supports soccer games configured as halves or quarters; older games without a saved format continue to use halves.
- Keeps a manually selected win/loss/tie distinct from the scoreboard. An unentered 0–0 is not treated as a recorded tie.

## Source layout

The archive preserves the original paths under `source/`:

- `artifacts/league-matrix-studio/src/features/stat-tracker*` — data model, live editor, reports, share helpers, spectator page, and tests.
- `artifacts/league-matrix-studio/src/features/season-stats*` — season history, review, validation, and tests.
- `artifacts/league-matrix-studio/src/features/tracker-*` — game completion, outcome, soccer-period controls, and related tests.
- `artifacts/api-server/src/routes/statTrackerShares.ts` — temporary live-share API and server-sent event updates.
- `artifacts/api-server/src/statTrackerShares.test.ts` — live-share API tests.
- `lib/db/src/schema/statTrackerShares.ts` — live-share database table.
- `lib/api-zod/src/generated/types/statTracker*.ts` — generated live-share request/response types.

`stat-tracker-page.tsx` is the authenticated editor. `season-stats-page.tsx` is the season review route. The public spectator page is mounted at `/live/:shareToken` in Pixl Sports.

## Host-app code not included

The tracker uses surrounding Pixl code that is broader than this feature:

- `@workspace/api-client-react` hooks for `/api/projects`, account access, athlete invites, and live-share endpoints.
- The generic cloud-project API and project database schema. Tracker history is stored in a `tool: "stat-tracker"` project payload, not a dedicated game-history table.
- Clerk authentication and account lifecycle checks.
- Shared Pixl UI components, Tailwind theme, routing, analytics, supporter profile/schedule helpers, and guest-access rules.
- Database migration setup and API server bootstrap.

Keep equivalent services from the destination project or replace these imports with adapters. Copying only the page component will not make it compile independently.

## Integration requirements

1. **Choose the feature boundary.** For private tracking, adapt `stat-tracker.ts`, the editor, and persistence. For season review, include the season-stats files. For live public viewing, also integrate the share API, database table, API validation/client methods, and spectator page.
2. **Map host services.** Replace Pixl-specific Clerk, `@workspace/api-client-react`, supporter profile, project CRUD, guest access, analytics, navigation, and schedule-draft imports with equivalents in the extension project.
3. **Preserve account isolation.** Local storage is account-keyed. Cloud reads and writes must be scoped to the authenticated owner. Clear account-specific UI state when the signed-in account changes.
4. **Preserve conflict recovery.** A transient network failure is retryable; a revision conflict is not. Keep local results and require an explicit history choice before resolving a conflict.
5. **Preserve sharing boundaries.** Live shares are public while active and expire after 24 hours; the owner can revoke them. The API checks ownership and revisions. The public stream exposes a bounded recent event list, not the full private history.
6. **Regenerate API bindings.** Included Zod types are generated snapshots. Prefer adding equivalent OpenAPI definitions and regenerating the destination project's server/client code instead of maintaining generated files manually.
7. **Review host-specific limits.** Pixl's guest allowance, 100-project cap, account lifecycle, and visual branding are product policy, not inherent tracker requirements.

## Runtime dependencies

The UI expects React, React DOM, TanStack Query, Wouter, Lucide React, and Pixl's generated React API client. Reports use Recharts. The live-share server code expects Express, Clerk Express, Drizzle ORM, and the Pixl `@workspace/db` / `@workspace/api-zod` packages.

The original app uses workspace dependency aliases and a shared package catalog. This archive does not include `node_modules`, compiled bundles, credentials, or a standalone package manifest.

## Suggested integration checks

- Track, pause/resume, undo, and finish a game; reload and verify local recovery.
- Verify completed history syncs for the right account and survives a fresh session.
- Simulate a network failure and a stale cloud revision; confirm retry and conflict-choice behavior remain distinct.
- Verify team versus athlete attribution, manual outcomes without a recorded score, and soccer halves/quarters.
- Verify season totals and a corrected final game after reload.
- If live sharing is enabled, test an unauthorized update, owner update, spectator refresh, expiry, and revocation.
