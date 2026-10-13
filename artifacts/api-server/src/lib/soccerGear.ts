import { and, eq, sql } from "drizzle-orm";
import { GetSoccerGearResponse } from "@workspace/api-zod";
import { athleteInvitesTable, db, soccerGearActivityTable, soccerGearLooksTable } from "@workspace/db";
import { defaultSoccerLoadout, unlockedSoccerGear } from "./soccerGearPolicy";

export type GearDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function creditExistingSoccerEventCards(owner: string) {
  // Existing saved cards qualify too. The ledger survives card deletion and
  // deduplicates retries/replacement cards by their underlying event identity.
  await db.execute(sql`
    insert into soccer_gear_activity (owner_clerk_user_id, kind, event_key)
    select distinct owner_clerk_user_id, 'event-card', events->0->>'id'
    from schedule_shares
    where owner_clerk_user_id = ${owner}
      and team_season = '@pixlsports:game-on-card:v1'
      and case when jsonb_typeof(events) = 'array' then jsonb_array_length(events) = 1 else false end
      and events->0->>'type' in ('game', 'practice')
      and coalesce(events->0->>'id', '') <> ''
    on conflict do nothing
  `);
}

export async function creditExistingSoccerTrackerGames(owner: string) {
  // Reconcile finalized cloud games created before Locker milestones existed.
  // The activity ledger deduplicates games across retries and project rewrites.
  await db.execute(sql`
    insert into soccer_gear_activity (owner_clerk_user_id, kind, event_key)
    select distinct owner_clerk_user_id, 'tracker-game', game->>'id'
    from cloud_projects
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(project->'games') = 'array' then project->'games'
        else '[]'::jsonb
      end
    ) as game
    where owner_clerk_user_id = ${owner}
      and project->>'tool' = 'stat-tracker'
      and game->>'status' = 'final'
      and coalesce(game->>'id', '') <> ''
    on conflict do nothing
  `);
}

export async function creditSoccerEventCard(database: GearDatabase, owner: string, eventId: string) {
  await database.insert(soccerGearActivityTable).values({
    ownerClerkUserId: owner, kind: "event-card", eventKey: eventId,
  }).onConflictDoNothing();
}

export async function creditSoccerTrackerGames(database: GearDatabase, owner: string, project: unknown) {
  if (!project || typeof project !== "object" || Array.isArray(project)) return;
  const payload = project as { tool?: unknown; games?: unknown };
  if (payload.tool !== "stat-tracker" || !Array.isArray(payload.games)) return;
  const gameIds = [...new Set(payload.games.flatMap((game): string[] => {
    if (!game || typeof game !== "object" || Array.isArray(game)) return [];
    const candidate = game as { id?: unknown; status?: unknown };
    return candidate.status === "final" && typeof candidate.id === "string" && candidate.id.trim()
      ? [candidate.id]
      : [];
  }))];
  if (!gameIds.length) return;
  await database.insert(soccerGearActivityTable).values(gameIds.map((gameId) => ({
    ownerClerkUserId: owner,
    kind: "tracker-game",
    eventKey: gameId,
  }))).onConflictDoNothing();
}

export async function readSoccerGear(owner: string, database: GearDatabase = db) {
  const [invite] = await database.select().from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.ownerClerkUserId, owner)).limit(1);
  const [counts] = await database.select({
    activeWeeks: sql<number>`count(*) filter (where ${soccerGearActivityTable.kind} = 'week')::int`,
    eventCardsCreated: sql<number>`least(10, count(*) filter (where ${soccerGearActivityTable.kind} = 'event-card'))::int`,
    trackerGamesCompleted: sql<number>`least(5, count(*) filter (where ${soccerGearActivityTable.kind} = 'tracker-game'))::int`,
    hypeCardShared: sql<boolean>`count(*) filter (where ${soccerGearActivityTable.kind} = 'share') > 0`,
  }).from(soccerGearActivityTable).where(eq(soccerGearActivityTable.ownerClerkUserId, owner));
  const progress = counts ?? { activeWeeks: 0, eventCardsCreated: 0, trackerGamesCompleted: 0, hypeCardShared: false };
  const [look] = invite ? await database.select().from(soccerGearLooksTable)
    .where(eq(soccerGearLooksTable.inviteId, invite.id)) : [];
  return {
    athleteId: invite?.id ?? null,
    athleteName: invite?.athleteName ?? "",
    canSave: Boolean(invite && invite.sport === "soccer"),
    showOnHypeCard: look?.showOnHypeCard ?? false,
    loadout: GetSoccerGearResponse.shape.loadout.parse(look?.loadout ?? defaultSoccerLoadout()),
    progress, unlockedGear: unlockedSoccerGear(progress),
  };
}

export async function publicSoccerGear(invite: { id: string; sport: string; showHypeCard: boolean }) {
  if (invite.sport !== "soccer" || !invite.showHypeCard) return null;
  const [look] = await db.select().from(soccerGearLooksTable).where(and(
    eq(soccerGearLooksTable.inviteId, invite.id),
    eq(soccerGearLooksTable.showOnHypeCard, true),
  ));
  return look ? GetSoccerGearResponse.shape.loadout.parse(look.loadout) : null;
}
