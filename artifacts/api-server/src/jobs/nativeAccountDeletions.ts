import { pool } from "@workspace/db";
import { deleteNativeProviderIdentity } from "../lib/nativeSignupIdentity";
import { logger } from "../lib/logger";
import { runExpiredAccountPurge } from "./purgeCancelledAccounts";
import type { NativeIdentity } from "../lib/nativeIdentity";

type Deletion = { id: string; native_issuer: string; native_subject: string; owner_id: string | null; scope: string };

/** Durable queue; retries work after provider/object failures and process exits.
 * A session advisory lock prevents two Autoscale workers processing one entry.
 */
export async function runNativeAccountDeletions(deps = {
  deleteIdentity: deleteNativeProviderIdentity,
  purgeOwner: async (owner: string) => { await runExpiredAccountPurge({ ownerClerkUserId: owner }); },
}, who?: Pick<NativeIdentity, "issuer"> & Partial<Pick<NativeIdentity, "subject">>) {
  const pending = await pool.query<Deletion>(
    `WITH candidates AS (
       SELECT id FROM native_account_deletions WHERE completed_at IS NULL
       ${who ? `AND native_issuer=$1 ${who.subject ? "AND native_subject=$2" : ""}` : ""}
       ORDER BY last_attempt_at ASC NULLS FIRST, requested_at, id
       LIMIT 25 FOR UPDATE SKIP LOCKED
     )
     UPDATE native_account_deletions AS deletion SET last_attempt_at=clock_timestamp()
     FROM candidates WHERE deletion.id=candidates.id RETURNING deletion.*`,
    who ? (who.subject ? [who.issuer, who.subject] : [who.issuer]) : []);
  // Rotate the selected batch atomically before external work. New requests
  // and requests not attempted recently remain reachable even if this entire
  // batch fails, its advisory locks are busy, or this process exits mid-run.
  for (const row of pending.rows) {
    const tx = await pool.connect();
    let locked = false;
    try {
      const lock = await tx.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [`native-delete:${row.id}`]);
      locked = lock.rows[0].locked;
      if (!locked) continue;
      const current = await tx.query("SELECT 1 FROM native_account_deletions WHERE id=$1 AND completed_at IS NULL", [row.id]);
      if (!current.rowCount) continue;
      // Provider deletion revokes every native session. A 404 is success; the
      // provider helper still proves the connection matches the native issuer.
      await deps.deleteIdentity({ issuer: row.native_issuer, subject: row.native_subject });
      if (row.scope === "independent") {
        if (!row.owner_id) throw new Error("Missing independent deletion owner");
        await deps.purgeOwner(row.owner_id);
        const access = await tx.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [row.owner_id]);
        if (access.rowCount) continue; // active lease or cleanup failure; retry later
      }
      await tx.query("BEGIN");
      await tx.query("DELETE FROM native_link_requests WHERE native_issuer=$1 AND native_subject=$2",
        [row.native_issuer, row.native_subject]);
      if (row.scope === "independent") {
        await tx.query("DELETE FROM native_accounts WHERE owner_id=$1 AND native_issuer=$2 AND native_subject=$3",
          [row.owner_id, row.native_issuer, row.native_subject]);
      }
      await tx.query("UPDATE native_account_deletions SET completed_at=NOW() WHERE id=$1", [row.id]);
      await tx.query("COMMIT");
    } catch {
      await tx.query("ROLLBACK");
      logger.warn({ deletionId: row.id }, "iPhone account cleanup needs retry");
    } finally {
      if (locked) await tx.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`native-delete:${row.id}`]);
      tx.release();
    }
  }
}
