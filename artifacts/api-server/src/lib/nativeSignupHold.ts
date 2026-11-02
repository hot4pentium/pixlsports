import { createHash } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";
import { loadNativeSignupIdentity } from "./nativeSignupIdentity";

export function nativeSignupEmailHashes(who: NativeIdentity, emails: string[]) {
  return [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))]
    .map(email => createHash("sha256").update(JSON.stringify(["native-signup-hold-v1", who.issuer, email])).digest("hex"));
}

/** Email is only an exclusion while cleanup is pending, never ownership proof. */
export async function assertNativeSignupEmailsAvailable(
  who: NativeIdentity, emails: string[], tx: Pick<PoolClient, "query"> = pool,
) {
  const normalized = [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))];
  if (!normalized.length) return;
  const held = await tx.query(`SELECT 1 FROM native_account_deletions
    WHERE native_issuer=$1 AND completed_at IS NULL
      AND (signup_hold_email_hashes && $2::text[]
        OR (signup_hold_email_hashes IS NULL AND LOWER(TRIM(completion_email))=ANY($3::text[])))
    LIMIT 1`, [who.issuer, nativeSignupEmailHashes(who, normalized), normalized]);
  if (held.rowCount) throw new NativeLinkError(423,
    "An iPhone account using this verified email is still being deleted. Wait for cleanup to finish, then try again.");
}

/** Called under the same setup/removal lock, including legacy link entrypoints. */
export async function assertNativeLinkSignupAvailable(
  who: NativeIdentity, tx: Pick<PoolClient, "query">,
  loadIdentity: typeof loadNativeSignupIdentity = loadNativeSignupIdentity,
) {
  const pending = await tx.query(`SELECT 1 FROM native_account_deletions
    WHERE native_issuer=$1 AND completed_at IS NULL
      AND (cardinality(signup_hold_email_hashes)>0 OR completion_email IS NOT NULL) LIMIT 1`, [who.issuer]);
  if (!pending.rowCount) return;
  const identity = await loadIdentity(who);
  await assertNativeSignupEmailsAvailable(who, identity.verifiedEmails, tx);
}
