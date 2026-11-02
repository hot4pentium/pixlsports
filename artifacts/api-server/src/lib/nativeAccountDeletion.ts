import { pool, type PoolClient } from "@workspace/db";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";

export async function assertNativeNotDeleting(who: NativeIdentity, tx: Pick<PoolClient, "query"> = pool) {
  const result = await tx.query(
    "SELECT 1 FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2",
    [who.issuer, who.subject],
  );
  if (result.rowCount) throw new NativeLinkError(423, "iPhone account removal has been requested. This sign-in can no longer access PIXL Sports.");
}

async function targetFor(who: NativeIdentity, tx: Pick<PoolClient, "query">) {
  const previous = await tx.query(
    "SELECT scope,target FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2",
    [who.issuer, who.subject],
  );
  if (previous.rows[0]) return previous.rows[0] as { scope: string; target: string };
  const native = await tx.query("SELECT owner_id FROM native_accounts WHERE native_issuer=$1 AND native_subject=$2",
    [who.issuer, who.subject]);
  const link = await tx.query("SELECT id,owner_clerk_user_id FROM native_account_links WHERE native_issuer=$1 AND native_subject=$2 FOR UPDATE",
    [who.issuer, who.subject]);
  if (native.rows[0]) {
    // Never treat a namespace or matching email as evidence of ownership.
    if (link.rows[0] && link.rows[0].owner_clerk_user_id !== native.rows[0].owner_id) {
      throw new NativeLinkError(409, "Your iPhone profile needs support before deletion.");
    }
    return { scope: "independent", target: native.rows[0].owner_id as string };
  }
  return { scope: "iphone_access", target: (link.rows[0]?.id ?? "unlinked") as string };
}

export async function previewNativeAccountDeletion(who: NativeIdentity) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(761119995)");
    const target = await targetFor(who, tx);
    const deletion = await tx.query("SELECT id,completed_at FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2",
      [who.issuer, who.subject]);
    await tx.query("COMMIT");
    return {
      ...target,
      supportReference: (deletion.rows[0]?.id as string | undefined) ?? null,
      status: deletion.rows[0] ? (deletion.rows[0].completed_at ? "completed" : "pending") : "not_requested",
      title: target.scope === "independent" ? "Delete iPhone account?" : "Remove iPhone access?",
      explanation: target.scope === "independent"
        ? "Permanently delete your iPhone sign-in, athlete profile, HYPE Cards, Event Cards, schedules, stats, checklists, saved projects, uploaded photos and videos, and alert settings. Shared links will stop working. All iPhones will be signed out and their alerts removed. Photos or videos already saved to a device are not deleted. This cannot be undone. A minimal deletion record is retained to prevent this sign-in from recreating the profile. Your verified iPhone sign-in email is temporarily kept for a completion notice, then erased after sending or seven days after cleanup."
        : "Permanently delete this iPhone sign-in, sign out all its iPhones, remove their alerts, and disconnect iPhone access. Your linked PWA sign-in, athlete profile, cards, photos, videos, stats, shared links, web alerts, and other PWA data will NOT be deleted. A minimal deletion record is retained to prevent this sign-in from reconnecting. This cannot be undone. Your verified iPhone sign-in email is temporarily kept for a completion notice, then erased after sending or seven days after cleanup.",
    };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally { tx.release(); }
}

export async function requestNativeAccountDeletion(who: NativeIdentity, confirmed: { scope: string; target: string }) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    // Same order as setup/linking; lifecycle writers use the owner lock too.
    await tx.query("SELECT pg_advisory_xact_lock(761119995)");
    const current = await targetFor(who, tx);
    if (current.scope !== confirmed.scope || current.target !== confirmed.target) {
      throw new NativeLinkError(409, "Your account changed. Review the removal details again.");
    }
    if (current.scope === "independent") {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [current.target]);
      await tx.query(`UPDATE account_access SET lifecycle_status='deletion_pending',
        deletion_eligible_at=NOW(),updated_at=NOW()
        WHERE owner_clerk_user_id=$1 AND lifecycle_status IN ('active','paused','cancelled')`, [current.target]);
      await tx.query("UPDATE athlete_invites SET paused=true WHERE owner_clerk_user_id=$1", [current.target]);
      await tx.query("UPDATE hype_card_shares SET revoked_at=COALESCE(revoked_at,NOW()) WHERE owner_clerk_user_id=$1", [current.target]);
    }
    await tx.query(`INSERT INTO native_account_deletions(native_issuer,native_subject,owner_id,scope,target)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(native_issuer,native_subject) DO NOTHING`,
    [who.issuer, who.subject, current.scope === "independent" ? current.target : null, current.scope, current.target]);
    await tx.query("DELETE FROM native_push_subscriptions WHERE native_issuer=$1 AND native_subject=$2",
      [who.issuer, who.subject]);
    await tx.query(`UPDATE native_link_requests SET status='cancelled'
      WHERE native_issuer=$1 AND native_subject=$2 AND status IN ('pending','approved')`, [who.issuer, who.subject]);
    await tx.query("DELETE FROM native_account_links WHERE native_issuer=$1 AND native_subject=$2",
      [who.issuer, who.subject]);
    // A reference identifies a receipt only; never use it to resolve authority.
    const receipt = await tx.query<{ id: string }>(
      "SELECT id FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2",
      [who.issuer, who.subject],
    );
    if (!receipt.rows[0]) throw new Error("Committed removal receipt is missing");
    await tx.query("COMMIT");
    return { status: "accepted" as const, supportReference: receipt.rows[0].id };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally { tx.release(); }
}
