import { and, eq, sql } from "drizzle-orm";
import { GetSportGearForAthleteResponse } from "@workspace/api-zod";
import { athleteInvitesTable, athleteSportGearLooksTable, db, soccerGearLooksTable } from "@workspace/db";
import { readGearProgress, type GearDatabase } from "./soccerGear";
import { defaultSportGearLoadout, gearSports, sportGearItems, type GearSport } from "./sportGearPolicy";

export function savedSportLook(payload: Record<string, unknown> | undefined, sport: GearSport) {
  const looks = payload?.sportLooks as Partial<Record<GearSport, unknown>> | undefined;
  const direct = payload && !looks ? payload : undefined;
  return GetSportGearForAthleteResponse.shape.loadout.parse(looks?.[sport] ?? direct ?? defaultSportGearLoadout());
}

export async function readSportGear(owner: string, sport: GearSport, database: GearDatabase = db, inviteId?: string, athleteName?: string) {
  const [invite] = await database.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.ownerClerkUserId, owner),
    eq(athleteInvitesTable.sport, sport),
    ...(inviteId ? [eq(athleteInvitesTable.id, inviteId)] : []),
    ...(athleteName?.trim() ? [sql`lower(trim(${athleteInvitesTable.athleteName})) = ${athleteName.trim().toLowerCase()}`] : []),
  )).limit(1);
  const [savedLook] = await database.select().from(athleteSportGearLooksTable).where(and(
    eq(athleteSportGearLooksTable.ownerClerkUserId, owner),
    eq(athleteSportGearLooksTable.sport, sport),
  )).limit(1);
  const [legacyLook] = !savedLook && invite
    ? await database.select().from(soccerGearLooksTable).where(eq(soccerGearLooksTable.inviteId, invite.id))
    : [];
  const progress = await readGearProgress(owner, database);
  const items = sportGearItems(sport, progress);
  const loadout = savedSportLook(savedLook?.loadout ?? legacyLook?.loadout, sport);
  // Never re-equip stale, invalid, or unearned items from persisted JSON.
  const earned = new Set(items.filter((item) => item.earned).map((item) => item.id));
  return {
    athleteId: invite?.id ?? null,
    athleteName: athleteName?.trim() || invite?.athleteName || "",
    sport, canSave: true,
    loadout: { ...loadout, equippedGear: loadout.equippedGear.filter((id) => earned.has(id)) },
    items, progress,
  };
}

export async function publicJerseyShowcaseGear(invite: { id: string; ownerClerkUserId: string; athleteName: string; sport: string }) {
  if (!gearSports.includes(invite.sport as GearSport)) return null;
  const state = await readSportGear(invite.ownerClerkUserId, invite.sport as GearSport, db, invite.id);
  // The dedicated Showcase route exposes only selected look data, not reward progress or owner identity.
  return { sport: state.sport, loadout: state.loadout, earnedGear: state.items.filter((item) => item.earned).map((item) => item.id) };
}
