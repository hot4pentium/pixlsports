import { ReplitConnectors } from "@replit/connectors-sdk";
import { pool, type PoolClient } from "@workspace/db";
import { loadNativeProviderIdentity } from "./nativeSignupIdentity";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";
import { logger } from "./logger";

type Receipt = {
  id: string;
  scope: string;
  completion_email: string;
  completion_email_first_attempt_at: Date | null;
};

export class DeletionCompletionEmailError extends Error {
  constructor(public readonly definitelyNotSent: boolean) {
    super("Deletion completion email was not confirmed");
  }
}

async function verifiedNativeEmail(who: NativeIdentity): Promise<string | null> {
  try {
    const user = await loadNativeProviderIdentity(who);
    const addresses = user.email_addresses.filter(item => item.verification?.status === "verified");
    addresses.sort((a, b) =>
      Number(b.id === user.primary_email_address_id) - Number(a.id === user.primary_email_address_id));
    return addresses[0]?.email_address.trim().toLowerCase() ?? null;
  } catch (error) {
    // Older requests may have already removed the provider identity.
    // Never infer a recipient from a PWA email or caller-supplied address.
    if (error instanceof NativeLinkError && error.status === 401) return null;
    throw error;
  }
}

/** Capture before deleting the native provider user, and preserve on retries. */
export async function prepareNativeDeletionCompletionEmail(
  deletion: { id: string; native_issuer: string; native_subject: string },
  resolveEmail: (who: NativeIdentity) => Promise<string | null> = verifiedNativeEmail,
  client: Pick<PoolClient, "query"> = pool,
) {
  const existing = await client.query(
    "SELECT completion_email_resolved_at FROM native_account_deletions WHERE id=$1", [deletion.id]);
  if (!existing.rows[0] || existing.rows[0].completion_email_resolved_at) return;
  const email = await resolveEmail({ issuer: deletion.native_issuer, subject: deletion.native_subject });
  await client.query(`UPDATE native_account_deletions
    SET completion_email=$2,completion_email_resolved_at=NOW()
    WHERE id=$1 AND completion_email_resolved_at IS NULL`, [deletion.id, email]);
}

export function deletionCompletionMessage(scope: string) {
  const independent = scope === "independent";
  return {
    subject: independent
      ? "Your PIXL Sports iPhone account has been deleted"
      : "Your PIXL Sports iPhone access has been removed",
    text: [
      independent
        ? "Your PIXL Sports iPhone account and its owned app data have been permanently deleted."
        : "Your PIXL Sports iPhone sign-in and access have been permanently removed.",
      "The old iPhone sign-in can no longer access PIXL Sports.",
      "",
      "Any separate or previously linked web/PWA account and its data were not deleted.",
      "Photos or videos previously saved to your device were not removed from that device.",
      "A minimal deletion record is retained to prevent the old sign-in from recreating access.",
      "",
      "You can create a new iPhone account with the same email address. It will be a fresh account; deleted iPhone data will not return.",
      "",
      "Questions? Contact support@pixlsports.com.",
    ].join("\n"),
  };
}

const connectors = new ReplitConnectors();
export async function sendNativeDeletionCompletionEmail(input: {
  id: string; scope: string; email: string; idempotencyKey: string;
}, proxy: typeof connectors.proxy = connectors.proxy.bind(connectors)) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const response = await proxy("resend", "/emails", {
          method: "POST",
          headers: { "Idempotency-Key": input.idempotencyKey },
          body: {
            from: "PIXL Sports <support@pixlsports.com>",
            to: [input.email],
            ...deletionCompletionMessage(input.scope),
          },
        });
        if (!response.ok) {
          // Retry definite rejections; retain the ambiguity window after timeouts/5xx.
          throw new DeletionCompletionEmailError([400, 401, 403, 404, 422, 429].includes(response.status));
        }
        const accepted = await response.json() as { id?: string };
        if (typeof accepted.id !== "string" || !accepted.id) throw new DeletionCompletionEmailError(false);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeletionCompletionEmailError(false)), 10_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Email delivery is independent of cleanup: failure never reopens access. */
export async function runNativeDeletionCompletionEmails(
  sendEmail: typeof sendNativeDeletionCompletionEmail = sendNativeDeletionCompletionEmail,
  who?: Pick<NativeIdentity, "issuer"> & Partial<Pick<NativeIdentity, "subject">>,
) {
  // Do not retain a deleted user's contact address indefinitely if delivery
  // is impossible. The permanent tombstone retains no email after this period.
  await pool.query(`UPDATE native_account_deletions SET completion_email=NULL
    WHERE completed_at < NOW()-INTERVAL '7 days' AND completion_email IS NOT NULL
    ${who ? `AND native_issuer=$1 ${who.subject ? "AND native_subject=$2" : ""}` : ""}`,
  who ? (who.subject ? [who.issuer, who.subject] : [who.issuer]) : []);
  const candidates = await pool.query<{ id: string }>(
    `WITH candidates AS (
      SELECT id FROM native_account_deletions
      WHERE completed_at IS NOT NULL AND completion_email IS NOT NULL AND completion_email_sent_at IS NULL
      ${who ? `AND native_issuer=$1 ${who.subject ? "AND native_subject=$2" : ""}` : ""}
      ORDER BY completion_email_last_attempt_at ASC NULLS FIRST,requested_at,id
      LIMIT 25 FOR UPDATE SKIP LOCKED
    ) UPDATE native_account_deletions AS deletion SET completion_email_last_attempt_at=clock_timestamp()
      FROM candidates WHERE deletion.id=candidates.id RETURNING deletion.id`,
    who ? (who.subject ? [who.issuer, who.subject] : [who.issuer]) : [],
  );
  for (const candidate of candidates.rows) {
    const tx = await pool.connect();
    let locked = false;
    let firstAttemptWasNew = false;
    try {
      const lock = await tx.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [`native-delete-email:${candidate.id}`]);
      locked = lock.rows[0].locked;
      if (!locked) continue;
      const current = await tx.query<Receipt>(`SELECT id,scope,completion_email,completion_email_first_attempt_at
        FROM native_account_deletions WHERE id=$1 AND completed_at IS NOT NULL
        AND completion_email IS NOT NULL AND completion_email_sent_at IS NULL`, [candidate.id]);
      const row = current.rows[0];
      if (!row) continue;
      // Resend keys expire after 24 hours. Never blindly resend an uncertain
      // attempt outside that window; leave it for operator review.
      if (row.completion_email_first_attempt_at
          && Date.now() - new Date(row.completion_email_first_attempt_at).getTime() >= 23 * 60 * 60 * 1000) {
        logger.warn({ deletionId: row.id }, "Deletion confirmation needs delivery review");
        continue;
      }
      firstAttemptWasNew = row.completion_email_first_attempt_at === null;
      await tx.query(`UPDATE native_account_deletions SET
        completion_email_first_attempt_at=COALESCE(completion_email_first_attempt_at,NOW()) WHERE id=$1`, [row.id]);
      await sendEmail({
        id: row.id, scope: row.scope, email: row.completion_email,
        idempotencyKey: `native-account-deleted-${row.id}`,
      });
      await tx.query(`UPDATE native_account_deletions
        SET completion_email_sent_at=NOW(),completion_email=NULL WHERE id=$1`, [row.id]);
    } catch (error) {
      if (error instanceof DeletionCompletionEmailError && error.definitelyNotSent && firstAttemptWasNew) {
        // Only reset a first attempt: an earlier ambiguous attempt must retain
        // its original deduplication deadline even if a later retry is rejected.
        await tx.query(`UPDATE native_account_deletions SET completion_email_first_attempt_at=NULL
          WHERE id=$1`, [candidate.id]);
      }
      logger.warn({ deletionId: candidate.id }, "Deletion confirmation email needs retry");
    } finally {
      if (locked) await tx.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",
        [`native-delete-email:${candidate.id}`]);
      tx.release();
    }
  }
}
