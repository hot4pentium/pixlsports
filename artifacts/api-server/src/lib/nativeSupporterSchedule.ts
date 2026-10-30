import { pool } from "@workspace/db";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { AthleteEventShareRow, AthleteTrackerShareRow, gameIdsFromAthleteEventShares, mapAthleteEventSummaries } from "./athleteEventSummaries";
import { GAME_ON_CARD_MARKER } from "./gameOnCard";
import type { NativeIdentity } from "./nativeIdentity";

export interface NativeSupporterScheduleResponse {
  status: "unlinked" | "linked";
  athleteName: string | null;
  teamName: string | null;
  seasonName: string | null;
  timezone: string | null;
  events: ReturnType<typeof mapAthleteEventSummaries>;
}

interface InviteRow {
  athlete_name: string;
  team_name: string;
  season_name: string;
  timezone: string | null;
}

export async function loadNativeSupporterSchedule(
  identity: NativeIdentity,
): Promise<NativeSupporterScheduleResponse> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const { rows: links } = await tx.query<{
      owner_clerk_user_id: string;
    }>(`SELECT owner_clerk_user_id
      FROM native_account_links
      WHERE native_issuer=$1 AND native_subject=$2
      FOR SHARE`, [identity.issuer, identity.subject]);
    const owner = links[0]?.owner_clerk_user_id;
    if (!owner) {
      await tx.query("COMMIT");
      return {
        status: "unlinked",
        athleteName: null,
        teamName: null,
        seasonName: null,
        timezone: null,
        events: [],
      };
    }

    // Keep the verified link and active account access stable for this read.
    await assertLinkableWebAccount(
      owner,
      tx,
      "This PIXL account can’t provide private schedule access right now. Check its account status on PIXL Sports.",
    );

    const { rows: invites } = await tx.query<InviteRow>(`SELECT athlete_name, team_name, season_name, timezone
      FROM athlete_invites
      WHERE owner_clerk_user_id=$1
      LIMIT 1`, [owner]);
    const { rows: shareRows } = await tx.query<AthleteEventShareRow>(`SELECT id::text AS id, title, events
      FROM schedule_shares
      WHERE owner_clerk_user_id=$1 AND team_season=$2
      ORDER BY updated_at DESC
      LIMIT 200`, [owner, GAME_ON_CARD_MARKER]);

    const gameIds = gameIdsFromAthleteEventShares(shareRows);
    const trackerRows = gameIds.length
      ? (await tx.query<AthleteTrackerShareRow>(`SELECT game_id AS "gameId", game
          FROM stat_tracker_shares
          WHERE owner_clerk_user_id=$1 AND game_id=ANY($2::text[])`, [owner, gameIds])).rows
      : [];

    const invite = invites[0];
    const response: NativeSupporterScheduleResponse = {
      status: "linked",
      athleteName: invite?.athlete_name ?? null,
      teamName: invite?.team_name ?? null,
      seasonName: invite?.season_name ?? null,
      timezone: invite?.timezone ?? null,
      events: mapAthleteEventSummaries(shareRows, trackerRows),
    };
    await tx.query("COMMIT");
    return response;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
