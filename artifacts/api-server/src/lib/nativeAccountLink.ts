import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import type { NativeLinkState } from "@workspace/api-zod";
import { getAccountLifecycleSnapshot } from "./accountLifecycle";
import { getAthleteEditorAccessForUser } from "./athleteEditorAccess";
import { NativeLinkError, nativeLinkWebOrigin, type NativeIdentity } from "./nativeIdentity";

const TTL = 10 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
type LinkRow = {
  id: string; native_issuer: string; native_subject: string;
  owner_clerk_user_id: string; account_label: string;
};
type RequestRow = LinkRow & {
  code_hash: string; code_challenge: string; status: string;
  expires_at: Date; completed_link_id: string | null;
};
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const verifierChallenge = (value: string) => createHash("sha256").update(value).digest("base64url");
const normalizeCode = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();
const nativeWhere = (who: NativeIdentity) => [who.issuer, who.subject];
const nativeState = (link?: LinkRow): NativeLinkState => link
  ? { status: "linked", linkId: link.id, accountLabel: link.account_label } : { status: "unlinked" };

export async function assertLinkableWebAccount(owner: string, tx?: PoolClient) {
  if (tx) {
    // Use the transaction's connection (not a second pooled connection while
    // other callers wait on the setup lock), and hold account eligibility stable
    // through completion. Mirror the app's automatic expired-pause resumption.
    const result = await tx.query(`SELECT a.id FROM account_access a
      WHERE a.owner_clerk_user_id=$1 AND a.admin_suspended_at IS NULL
      AND (a.lifecycle_status='active' OR (a.lifecycle_status='paused' AND a.pause_ends_at<=NOW()))
      AND NOT EXISTS (SELECT 1 FROM admin_identity_blocks b WHERE b.clerk_user_id=$1)
      AND NOT EXISTS (SELECT 1 FROM athlete_editor_access e WHERE e.athlete_clerk_user_id=$1 AND NOT e.existing_account)
      FOR SHARE OF a`, [owner]);
    if (!result.rowCount) throw new NativeLinkError(423, "This PIXL account is not eligible for an iPhone connection.");
    return;
  }
  const [lifecycle, editor] = await Promise.all([
    getAccountLifecycleSnapshot(owner),
    getAthleteEditorAccessForUser(owner),
  ]);
  if (lifecycle.status !== "active" || lifecycle.identityBlocked || lifecycle.adminSuspended
    || (editor && !editor.existingAccount)) {
    throw new NativeLinkError(423, "This PIXL account is not eligible for an iPhone connection.");
  }
}

// These low-volume, one-time setup operations share a transaction-scoped lock.
// It gives approval/completion/revocation one consistent order across Autoscale
// instances, in addition to unique constraints on both sides of the mapping.
async function transaction<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(761119995)");
    const result = await work(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally { tx.release(); }
}

export async function limitNativeLinkAction(actor: string, action: string, maximum: number) {
  const { rows } = await pool.query<{ count: number }>(`
    INSERT INTO native_link_rate_limits (key, count, resets_at)
    VALUES ($1, 1, NOW() + INTERVAL '10 minutes')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN native_link_rate_limits.resets_at <= NOW() THEN 1 ELSE native_link_rate_limits.count + 1 END,
      resets_at = CASE WHEN native_link_rate_limits.resets_at <= NOW() THEN NOW() + INTERVAL '10 minutes' ELSE native_link_rate_limits.resets_at END
    RETURNING count`, [digest(`${action}:${actor}`)]);
  if (rows[0].count > maximum) throw new NativeLinkError(429, "Too many attempts. Wait ten minutes and try again.");
}

export function createNativeAccountLinkService(
  assertOwner: (owner: string, tx?: PoolClient) => Promise<void> = assertLinkableWebAccount,
) {
  async function current(who: NativeIdentity): Promise<NativeLinkState> {
    const { rows } = await pool.query<LinkRow>(
      "SELECT * FROM native_account_links WHERE native_issuer=$1 AND native_subject=$2", nativeWhere(who),
    );
    return nativeState(rows[0]);
  }
  async function webCurrent(owner: string): Promise<NativeLinkState> {
    const { rows } = await pool.query<LinkRow>(
      "SELECT * FROM native_account_links WHERE owner_clerk_user_id=$1", [owner],
    );
    const link = rows[0];
    if (link) return { status: "linked", linkId: link.id, accountLabel: `iPhone account …${link.native_subject.slice(-6)}` };
    const pending = await pool.query<RequestRow>(`SELECT * FROM native_link_requests
      WHERE owner_clerk_user_id=$1 AND status='approved' AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1`, [owner]);
    const request = pending.rows[0];
    return request ? {
      status: "approved", requestId: request.id, expiresAt: request.expires_at,
      accountLabel: `iPhone account …${request.native_subject.slice(-6)}`,
    } : { status: "unlinked" };
  }
  async function start(who: NativeIdentity, challenge: string): Promise<NativeLinkState> {
    return transaction(async (tx) => {
      const existing = await tx.query<LinkRow>(
        "SELECT * FROM native_account_links WHERE native_issuer=$1 AND native_subject=$2", nativeWhere(who),
      );
      if (existing.rows[0]) return nativeState(existing.rows[0]);
      await tx.query(`UPDATE native_link_requests SET status='cancelled'
        WHERE native_issuer=$1 AND native_subject=$2 AND status IN ('pending','approved')`, nativeWhere(who));
      const code = Array.from(randomBytes(8), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
      const expires = new Date(Date.now() + TTL);
      const { rows } = await tx.query<RequestRow>(`
        INSERT INTO native_link_requests (native_issuer,native_subject,code_hash,code_challenge,expires_at)
        VALUES ($1,$2,$3,$4,$5) RETURNING *`, [...nativeWhere(who), digest(code), challenge, expires]);
      // Retain completed requests long enough for retry idempotency, then remove
      // expired handshakes; link ownership is stored independently.
      await tx.query("DELETE FROM native_link_requests WHERE expires_at < NOW() - INTERVAL '1 day'");
      return {
        status: "pending", requestId: rows[0].id, expiresAt: expires,
        userCode: `${code.slice(0, 4)}-${code.slice(4)}`,
        verificationUrl: `${nativeLinkWebOrigin()}/connect/iphone`,
      };
    });
  }
  async function proof(tx: PoolClient, who: NativeIdentity, id: string, verifier: string) {
    const { rows } = await tx.query<RequestRow>(`
      SELECT * FROM native_link_requests WHERE id=$1 AND native_issuer=$2 AND native_subject=$3 FOR UPDATE`,
    [id, ...nativeWhere(who)]);
    const row = rows[0];
    const challenge = verifierChallenge(verifier);
    if (!row || row.code_challenge.length !== challenge.length
      || !timingSafeEqual(Buffer.from(row.code_challenge), Buffer.from(challenge))) {
      throw new NativeLinkError(404, "This linking attempt is unavailable.");
    }
    return row;
  }
  function requestState(row: RequestRow): NativeLinkState {
    if (row.expires_at.getTime() <= Date.now()) return { status: "expired" };
    return {
      status: row.status as NativeLinkState["status"],
      requestId: row.id, expiresAt: row.expires_at,
      ...(row.status === "approved" && row.account_label ? { accountLabel: row.account_label } : {}),
    };
  }
  async function poll(who: NativeIdentity, id: string, verifier: string): Promise<NativeLinkState> {
    return transaction(async (tx) => {
      const row = await proof(tx, who, id, verifier);
      if (row.status === "completed") {
        const link = await tx.query<LinkRow>("SELECT * FROM native_account_links WHERE id=$1", [row.completed_link_id]);
        return link.rows[0] ? { ...nativeState(link.rows[0]), status: "completed" } : { status: "cancelled" };
      }
      return requestState(row);
    });
  }
  async function preview(owner: string, rawCode: string): Promise<NativeLinkState> {
    await assertOwner(owner);
    const code = normalizeCode(rawCode);
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new NativeLinkError(404, "The code is invalid or expired.");
    const { rows } = await pool.query<RequestRow>(
      "SELECT * FROM native_link_requests WHERE code_hash=$1", [digest(code)],
    );
    const row = rows[0];
    if (!row || row.expires_at.getTime() <= Date.now()
      || !["pending", "approved"].includes(row.status)
      || (row.owner_clerk_user_id && row.owner_clerk_user_id !== owner)) {
      throw new NativeLinkError(404, "The code is invalid or expired.");
    }
    return {
      status: row.status as "pending" | "approved", requestId: row.id,
      userCode: `${code.slice(0, 4)}-${code.slice(4)}`,
      expiresAt: row.expires_at, accountLabel: `iPhone account …${row.native_subject.slice(-6)}`,
    };
  }
  async function decide(owner: string, id: string, code: string, decision: "approve" | "deny", label: string): Promise<NativeLinkState> {
    return transaction(async (tx) => {
      await assertOwner(owner, tx);
      const { rows } = await tx.query<RequestRow>("SELECT * FROM native_link_requests WHERE id=$1 FOR UPDATE", [id]);
      const row = rows[0];
      if (!row || row.code_hash !== digest(normalizeCode(code)) || row.expires_at.getTime() <= Date.now()) {
        throw new NativeLinkError(404, "The code is invalid or expired.");
      }
      if (!["pending", "approved"].includes(row.status)
        || (row.owner_clerk_user_id && row.owner_clerk_user_id !== owner)) {
        throw new NativeLinkError(409, "This attempt is no longer available.");
      }
      if (decision === "approve") {
        const conflict = await tx.query(`SELECT id FROM native_account_links
          WHERE owner_clerk_user_id=$1 OR (native_issuer=$2 AND native_subject=$3)`,
        [owner, row.native_issuer, row.native_subject]);
        if (conflict.rowCount) throw new NativeLinkError(409, "An account is already connected. Disconnect it first.");
      }
      const status = decision === "approve" ? "approved" : "denied";
      await tx.query(`UPDATE native_link_requests SET status=$2, owner_clerk_user_id=$3, account_label=$4 WHERE id=$1`,
        [id, status, owner, label]);
      return { status, requestId: id, expiresAt: row.expires_at };
    });
  }
  async function complete(who: NativeIdentity, id: string, verifier: string): Promise<NativeLinkState> {
    return transaction(async (tx) => {
      const row = await proof(tx, who, id, verifier);
      if (row.status === "completed") {
        const { rows } = await tx.query<LinkRow>("SELECT * FROM native_account_links WHERE id=$1", [row.completed_link_id]);
        if (rows[0]) return nativeState(rows[0]);
        throw new NativeLinkError(410, "This connection was disconnected. Start a new attempt.");
      }
      if (row.expires_at.getTime() <= Date.now()) throw new NativeLinkError(410, "This code expired. Start a new attempt.");
      if (row.status !== "approved" || !row.owner_clerk_user_id || !row.account_label) {
        throw new NativeLinkError(409, "Approve this code on the web before confirming it on the iPhone.");
      }
      await assertOwner(row.owner_clerk_user_id, tx);
      const existing = await tx.query(`SELECT id FROM native_account_links
        WHERE owner_clerk_user_id=$1 OR (native_issuer=$2 AND native_subject=$3)`,
      [row.owner_clerk_user_id, ...nativeWhere(who)]);
      if (existing.rowCount) throw new NativeLinkError(409, "An account is already connected. Disconnect it first.");
      const { rows } = await tx.query<LinkRow>(`INSERT INTO native_account_links
        (native_issuer,native_subject,owner_clerk_user_id,account_label) VALUES ($1,$2,$3,$4) RETURNING *`,
      [...nativeWhere(who), row.owner_clerk_user_id, row.account_label]);
      await tx.query("UPDATE native_link_requests SET status='completed',completed_link_id=$2 WHERE id=$1", [id, rows[0].id]);
      return nativeState(rows[0]);
    });
  }
  async function cancel(who: NativeIdentity, id: string, verifier: string): Promise<NativeLinkState> {
    return transaction(async (tx) => {
      const row = await proof(tx, who, id, verifier);
      if (["pending", "approved"].includes(row.status)) {
        await tx.query("UPDATE native_link_requests SET status='cancelled' WHERE id=$1", [id]);
      }
      return { status: row.status === "completed" ? "completed" : "cancelled" };
    });
  }
  async function disconnect(who: NativeIdentity | string): Promise<NativeLinkState> {
    return transaction(async (tx) => {
      if (typeof who === "string") {
        await tx.query(`UPDATE native_link_requests SET status='cancelled'
          WHERE owner_clerk_user_id=$1 AND status IN ('pending','approved')`, [who]);
        await tx.query("DELETE FROM native_account_links WHERE owner_clerk_user_id=$1", [who]);
      } else {
        await tx.query(`UPDATE native_link_requests SET status='cancelled'
          WHERE native_issuer=$1 AND native_subject=$2 AND status IN ('pending','approved')`, nativeWhere(who));
        await tx.query("DELETE FROM native_account_links WHERE native_issuer=$1 AND native_subject=$2", nativeWhere(who));
      }
      return { status: "unlinked" };
    });
  }
  return { current, webCurrent, start, poll, preview, decide, complete, cancel, disconnect };
}
export const nativeAccountLinkService = createNativeAccountLinkService();
