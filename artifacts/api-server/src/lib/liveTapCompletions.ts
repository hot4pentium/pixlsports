import { and, count, desc, eq, isNull } from "drizzle-orm";
import { athleteInvitesTable, athleteInviteLiveTapsTable, athleteLiveTapCompletionsTable, db, pool, statTrackerSharesTable } from "@workspace/db";
import { getLiveTapCheerPresets } from "./athleteLiveTaps";
type PoolClient = Pick<typeof pool, "query">;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Completion = typeof athleteLiveTapCompletionsTable.$inferSelect;

export function publicCompletion(row: Completion) {
  return {
    id: row.id, gameId: row.gameId, eventId: row.eventId,
    athleteName: row.athleteName, eventTitle: row.eventTitle, sport: row.sport,
    seasonId: row.seasonKey === "legacy" ? null : row.seasonKey,
    endedAt: row.endedAt.toISOString(), cheers: row.cheers,
  };
}

export async function completedLiveTapSessions(inviteId: string) {
  const rows = await db.select().from(athleteLiveTapCompletionsTable)
    .where(eq(athleteLiveTapCompletionsTable.inviteId, inviteId))
    .orderBy(desc(athleteLiveTapCompletionsTable.endedAt));
  return rows.map(publicCompletion);
}

/** Caller holds invite FOR UPDATE, the same lock used by cheer delivery. */
export async function completeLiveTapSession(
  tx: Transaction,
  invite: typeof athleteInvitesTable.$inferSelect,
  share: typeof statTrackerSharesTable.$inferSelect,
) {
  const game = share.game as Record<string, unknown>;
  const rows = await tx.select({ key: athleteInviteLiveTapsTable.cheerKey, total: count() })
    .from(athleteInviteLiveTapsTable).where(and(
      eq(athleteInviteLiveTapsTable.inviteId, invite.id),
      eq(athleteInviteLiveTapsTable.gameId, share.gameId),
      invite.liveTapsSeasonId
        ? eq(athleteInviteLiveTapsTable.seasonId, invite.liveTapsSeasonId)
        : isNull(athleteInviteLiveTapsTable.seasonId),
    )).groupBy(athleteInviteLiveTapsTable.cheerKey);
  const totals = new Map(rows.map(row => [row.key, row.total]));
  const seasonKey = invite.liveTapsSeasonId ?? "legacy";
  await tx.insert(athleteLiveTapCompletionsTable).values({
    inviteId: invite.id, gameId: share.gameId, seasonKey,
    eventId: typeof game.sourceEventId === "string" ? game.sourceEventId : null,
    athleteName: invite.athleteName,
    eventTitle: [typeof game.date === "string" ? game.date : "", typeof game.opponent === "string" && game.opponent ? `vs ${game.opponent}` : ""].filter(Boolean).join(" · ") || invite.teamName,
    sport: invite.sport,
    cheers: getLiveTapCheerPresets(invite.sport).map(cheer => ({ ...cheer, count: totals.get(cheer.key) ?? 0 })),
  }).onConflictDoNothing();
  const [saved] = await tx.select().from(athleteLiveTapCompletionsTable).where(and(
    eq(athleteLiveTapCompletionsTable.inviteId, invite.id),
    eq(athleteLiveTapCompletionsTable.gameId, share.gameId),
    eq(athleteLiveTapCompletionsTable.seasonKey, seasonKey),
  ));
  return saved ? publicCompletion(saved) : null;
}

/** Native workspace uses a pg transaction. Keep its aggregate in that transaction too. */
export async function completeNativeLiveTapSessions(tx: PoolClient, owner: string, shareIDs: string[]) {
  const sessions = await tx.query<{
    id: string; athlete_name: string; team_name: string; sport: string; live_taps_season_id: string | null;
    game_id: string; game: Record<string, unknown>;
  }>(`SELECT i.id,i.athlete_name,i.team_name,i.sport,i.live_taps_season_id,s.game_id,s.game
      FROM athlete_invites i JOIN stat_tracker_shares s ON s.id::text=i.live_tracker_share_token
      WHERE i.owner_clerk_user_id=$1 AND s.id::text=ANY($2::text[]) FOR UPDATE OF i`, [owner, shareIDs]);
  for (const session of sessions.rows) {
    if (session.game.liveTapsEnded === true) continue;
    const counts = await tx.query<{ cheer_key: string; total: string }>(
      `SELECT cheer_key,COUNT(*) AS total FROM athlete_invite_live_taps
       WHERE invite_id=$1 AND game_id=$2 AND season_id IS NOT DISTINCT FROM $3::uuid GROUP BY cheer_key`,
      [session.id, session.game_id, session.live_taps_season_id],
    );
    const totals = new Map(counts.rows.map(row => [row.cheer_key, Number(row.total)]));
    const cheers = getLiveTapCheerPresets(session.sport).map(cheer => ({ ...cheer, count: totals.get(cheer.key) ?? 0 }));
    await tx.query(`INSERT INTO athlete_live_tap_completions
      (invite_id,game_id,season_key,event_id,athlete_name,event_title,sport,cheers)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING`, [
      session.id, session.game_id, session.live_taps_season_id ?? "legacy",
      typeof session.game.sourceEventId === "string" ? session.game.sourceEventId : null,
      session.athlete_name,
      [session.game.date, session.game.opponent ? `vs ${session.game.opponent}` : ""].filter(Boolean).join(" · ") || session.team_name,
      session.sport, JSON.stringify(cheers),
    ]);
  }
}
