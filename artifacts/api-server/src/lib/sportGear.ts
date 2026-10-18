import { and, eq } from "drizzle-orm";
import { GetSportGearResponse } from "@workspace/api-zod";
import { athleteInvitesTable, db, soccerGearLooksTable } from "@workspace/db";
import { readGearProgress, type GearDatabase } from "./soccerGear";
import { defaultSportGearLoadout, gearSports, sportGearItems, type GearSport } from "./sportGearPolicy";

export function savedSportLook(payload: Record<string, unknown> | undefined, sport: GearSport) {
  const looks = payload?.sportLooks as Partial<Record<GearSport, unknown>> | undefined;
  return GetSportGearResponse.shape.loadout.parse(looks?.[sport] ?? defaultSportGearLoadout());
}

export async function readSportGear(owner: string, sport: GearSport, database: GearDatabase = db, inviteId?: string) {
  const [invite] = await database.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.ownerClerkUserId, owner),
    ...(inviteId ? [eq(athleteInvitesTable.id, inviteId)] : []),
  )).limit(1);
  const matches = invite?.sport === sport;
  const [look] = matches ? await database.select().from(soccerGearLooksTable).where(eq(soccerGearLooksTable.inviteId, invite.id)) : [];
  const progress = await readGearProgress(owner, database);
  const items = sportGearItems(sport, progress);
  const loadout = savedSportLook(look?.loadout, sport);
  // Never re-equip stale, invalid, or unearned items from persisted JSON.
  const earned = new Set(items.filter((item) => item.earned).map((item) => item.id));
  return {
    athleteId: matches ? invite.id : null,
    athleteName: matches ? invite.athleteName : "",
    sport, canSave: Boolean(matches), showOnHypeCard: look?.showOnHypeCard ?? false,
    loadout: { ...loadout, equippedGear: loadout.equippedGear.filter((id) => earned.has(id)) },
    items, progress,
  };
}

export async function publicSportGear(invite: { id: string; ownerClerkUserId: string; sport: string; showHypeCard: boolean }) {
  if (!invite.showHypeCard || !gearSports.includes(invite.sport as GearSport)) return null;
  const state = await readSportGear(invite.ownerClerkUserId, invite.sport as GearSport, db, invite.id);
  if (!state.showOnHypeCard) return null;
  // Recipient contract deliberately excludes activity counts and private identity.
  return { sport: state.sport, loadout: state.loadout, earnedGear: state.items.filter((item) => item.earned).map((item) => item.id) };
}
