import { randomBytes } from "node:crypto";
import type { PoolClient } from "@workspace/db";

export const starterSports = ["soccer", "basketball", "volleyball", "football", "baseball", "softball"] as const;
export function savedStarterSport(value: unknown): string | undefined {
  return typeof value === "string" && (starterSports as readonly string[]).includes(value) ? value : undefined;
}

export type NativeStarterCard = {
  public_token: string; athlete_name: string; team_name: string;
  sport: string; season_name: string;
};

export async function findNativeOwnerCard(tx: PoolClient, owner: string) {
  const { rows } = await tx.query<NativeStarterCard>(
    `SELECT public_token, athlete_name, team_name, sport, season_name
     FROM athlete_invites WHERE owner_clerk_user_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [owner],
  );
  return rows[0];
}

export async function assignNativeStarterCard(
  tx: PoolClient, owner: string,
  profile: { athleteName: string; teamName: string; sport?: string },
  metadata: Record<string, unknown>,
): Promise<NativeStarterCard> {
  const now = new Date();
  // Same rolling season boundary as web onboarding; never create an already
  // expired starter, including during late-year setup.
  const endYear = now.getUTCFullYear() + (now.getUTCMonth() > 6 ? 1 : 0);
  const seasonEnd = new Date(Date.UTC(endYear, 11, 31, 23, 59, 59, 999));
  const seasonName = typeof metadata.seasonName === "string" && metadata.seasonName.trim()
    ? metadata.seasonName.trim() : String(now.getUTCFullYear());
  const sport = profile.sport ?? savedStarterSport(metadata.sport) ?? "soccer";
  let timezone = typeof metadata.timezone === "string" ? metadata.timezone : "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { timezone = "UTC"; }
  const { rows } = await tx.query<NativeStarterCard>(
    `INSERT INTO athlete_invites
       (owner_clerk_user_id, public_token, athlete_name, team_name, season_name,
        season_ends_at, sport, timezone, show_hype_card, show_stats, show_schedule, show_events, paused)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,false,false,false,true)
     ON CONFLICT (owner_clerk_user_id) DO NOTHING
     RETURNING public_token, athlete_name, team_name, sport, season_name`,
    [owner, randomBytes(24).toString("base64url"), profile.athleteName, profile.teamName,
      seasonName, seasonEnd, sport, timezone],
  );
  // The unique-owner constraint also protects against web setup winning the
  // race. Its authored card remains authoritative.
  const card = rows[0] ?? await findNativeOwnerCard(tx, owner);
  if (!card) throw new Error("The private starter HYPE Card could not be assigned.");
  return card;
}
