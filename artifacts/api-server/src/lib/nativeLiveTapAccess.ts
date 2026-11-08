import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { GAME_ON_CARD_MARKER } from "./gameOnCard";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";

export async function nativeLiveTapAccess(
  identity: NativeIdentity,
  shareToken: string,
  action: "list" | "create" | "revoke",
  accessId?: string,
) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const link = (await tx.query<{ owner_clerk_user_id: string }>(
      `SELECT owner_clerk_user_id FROM native_account_links
       WHERE native_issuer=$1 AND native_subject=$2 FOR SHARE`,
      [identity.issuer, identity.subject],
    )).rows[0];
    if (!link) throw new NativeLinkError(409, "Connect your PIXL account first.");
    const owner = link.owner_clerk_user_id;
    await assertLinkableWebAccount(owner, tx);
    if (action !== "list") {
      const mode = (await tx.query<{ access_mode: string }>(
        "SELECT access_mode FROM account_access WHERE owner_clerk_user_id=$1", [owner],
      )).rows[0]?.access_mode;
      if (mode === "guest") throw new NativeLinkError(403, "Guest accounts cannot change fan QR access.");
    }
    const card = (await tx.query<{ events: Array<{ id: string; type: string }> }>(
      `SELECT events FROM schedule_shares WHERE id=$1
       AND owner_clerk_user_id=$2 AND team_season=$3 FOR SHARE`,
      [shareToken, owner, GAME_ON_CARD_MARKER],
    )).rows[0];
    if (!card || card.events.length !== 1 || card.events[0]?.type !== "game") {
      throw new NativeLinkError(404, "This game Event Card is not available to your account.");
    }
    const invite = (await tx.query<{
      id: string; public_token: string; paused: boolean; available: boolean; sport: string;
      game_id: string | null;
      game: { id?: string; sourceEventId?: string; status?: string; sport?: string } | null;
    }>(
      `SELECT ai.id,ai.public_token,ai.paused,(ai.season_ends_at>NOW()) AS available,ai.sport,s.game_id,s.game
       FROM athlete_invites ai LEFT JOIN stat_tracker_shares s
       ON s.id::text=ai.live_tracker_share_token AND s.owner_clerk_user_id=ai.owner_clerk_user_id
       AND s.expires_at>NOW()
       WHERE ai.owner_clerk_user_id=$1 LIMIT 1 FOR UPDATE OF ai`,
      [owner],
    )).rows[0];
    if (!invite) throw new NativeLinkError(404, "No athlete HYPE Card is available.");

    if (action === "create") {
      if (invite.paused) {
        throw new NativeLinkError(403, "Fan QR sharing is unavailable while your public HYPE Card page is paused.");
      }
      if (!invite.available) {
        throw new NativeLinkError(410, "This HYPE Card’s access has expired.");
      }
      const eventId = card.events[0]!.id;
      const sessionMatchesEvent = invite.game_id === eventId
        || invite.game?.sourceEventId === eventId
        || invite.game?.id === eventId;
      if (invite.paused || !invite.available || !sessionMatchesEvent
          || !invite.game || invite.game.status === "final" || invite.game.sport !== invite.sport) {
        throw new NativeLinkError(409, "Live Taps must be active for this Event Card before sharing a fan QR.");
      }
      const active = (await tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM athlete_invite_live_tap_access_links WHERE invite_id=$1 AND revoked_at IS NULL",
        [invite.id],
      )).rows[0];
      if (Number(active?.count ?? 0) >= 50) {
        throw new NativeLinkError(409, "Revoke an older fan QR before creating another.");
      }
      const id = randomUUID();
      const accessToken = randomBytes(32).toString("base64url");
      await tx.query(
        `INSERT INTO athlete_invite_live_tap_access_links(id,invite_id,token_hash)
         VALUES($1,$2,$3)`,
        [id, invite.id, createHash("sha256").update(accessToken).digest("hex")],
      );
      await tx.query("COMMIT");
      return { id, accessToken, inviteToken: invite.public_token };
    }
    if (action === "revoke") {
      if (!accessId) throw new NativeLinkError(400, "Choose the fan QR to revoke.");
      const removed = (await tx.query(
        `UPDATE athlete_invite_live_tap_access_links SET revoked_at=NOW()
         WHERE id=$1 AND invite_id=$2 AND revoked_at IS NULL RETURNING id`,
        [accessId, invite.id],
      )).rows[0];
      if (!removed) throw new NativeLinkError(404, "This fan QR is already revoked or unavailable.");
      await tx.query("COMMIT");
      return { revoked: true };
    }
    const links = (await tx.query(
      `SELECT id,created_at AS "createdAt" FROM athlete_invite_live_tap_access_links
       WHERE invite_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [invite.id],
    )).rows;
    await tx.query("COMMIT");
    return { links };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
