import { createHash } from "node:crypto";
import { db, pool, type PoolClient } from "@workspace/db";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { isNativeProfileOwner } from "./nativeOwnerMetadata";

export const nativeStarterPauseFingerprint = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Default starter privacy is not an owner-requested Live Taps pause. Never
 * unpause the public page to start private owner cheers. An explicit settings
 * save writes a null marker and closes the live pointer, ending this exception.
 */
export async function hasNativeStarterPrivacyPause(
  owner: string, token: string, tx?: PoolClient | Pick<typeof db, "execute">,
): Promise<boolean> {
  if (!isNativeProfileOwner(owner)) return false;
  const query = sql`SELECT EXISTS(
       SELECT 1 FROM native_accounts na
       JOIN athlete_invites ai ON ai.owner_clerk_user_id=na.owner_id
       WHERE na.owner_id=${owner} AND ai.public_token=${token} AND ai.paused=true
         AND NOT ai.show_hype_card AND NOT ai.show_stats
         AND NOT ai.show_schedule AND NOT ai.show_events
         AND (
           na.profile_metadata->>'nativeStarterPrivatePause'=${nativeStarterPauseFingerprint(token)}
           OR (
             NOT (na.profile_metadata ? 'nativeStarterPrivatePause')
             AND ai.created_at=ai.updated_at
           )
         )
     ) AS allowed`;
  if (tx && "execute" in tx) {
    const result = await tx.execute(query);
    return result.rows[0]?.allowed === true;
  }
  const compiled = new PgDialect().sqlToQuery(query);
  const result = await (tx ?? pool).query<{ allowed: boolean }>(compiled.sql, compiled.params);
  return result.rows[0]?.allowed === true;
}
