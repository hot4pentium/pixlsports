import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { getAdminClerkClient } from "./adminAccess";
import { isEligibleForInitialAccountSetup } from "./accountProvisioning";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";
import { loadNativeSignupIdentity } from "./nativeSignupIdentity";

type LegacyOwner = {
  id: string; externalId: string | null; createdAt: number;
  publicMetadata: Record<string, unknown>; unsafeMetadata: Record<string, unknown>;
};
type Dependencies = {
  loadIdentity: typeof loadNativeSignupIdentity;
  findOwners: (externalId: string) => Promise<LegacyOwner[]>;
};
const defaults: Dependencies = {
  loadIdentity: loadNativeSignupIdentity,
  async findOwners(externalId) {
    // Only check the exact former native-signup origin for recovery protection.
    // Never look up PWA accounts by email, create a web identity, or copy data.
    const result = await getAdminClerkClient().users.getUserList({ externalId: [externalId], limit: 2 });
    if (result.totalCount > 1) throw new NativeLinkError(409, "Your iPhone account needs recovery.");
    return result.data;
  },
};
export type NativeAccountPreparation = { status: "ready" | "link_required" };
export function nativeSignupExternalId(who: NativeIdentity) {
  return `pixl-ios:${createHash("sha256").update(JSON.stringify([who.issuer, who.subject])).digest("hex")}`;
}

export function createNativeAccountPreparation(deps: Dependencies = defaults) {
  return async (who: NativeIdentity): Promise<NativeAccountPreparation> => {
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      // Share the ordering used by explicit legacy link approval/disconnect.
      await tx.query("SELECT pg_advisory_xact_lock(761119995)");
      const existing = await tx.query<{ owner_clerk_user_id: string }>(
        "SELECT owner_clerk_user_id FROM native_account_links WHERE native_issuer=$1 AND native_subject=$2 FOR UPDATE",
        [who.issuer, who.subject],
      );
      if (existing.rows[0]) {
        await assertLinkableWebAccount(existing.rows[0].owner_clerk_user_id, tx);
        await tx.query("COMMIT");
        return { status: "ready" };
      }
      const owner = nativeSignupExternalId(who);
      const previous = await tx.query(
        "SELECT 1 FROM native_accounts WHERE native_issuer=$1 AND native_subject=$2 FOR UPDATE",
        [who.issuer, who.subject],
      );
      // Keep the permanent profile after disconnect: never erase it, replace
      // it, or silently recreate access for a cancelled/revoked native identity.
      if (previous.rowCount) {
        throw new NativeLinkError(423, "Your iPhone profile access needs recovery. Please contact support.");
      }
      const identity = await deps.loadIdentity(who);
      if (!identity.verifiedEmails.length) {
        throw new NativeLinkError(423, "Verify your email address before setting up your iPhone profile.");
      }
      const origins = (await deps.findOwners(owner)).filter(o => o.externalId === owner);
      if (origins.length > 1) throw new NativeLinkError(409, "Your iPhone account needs recovery.");
      if (origins[0]) {
        const legacy = origins[0];
        const access = await tx.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [legacy.id]);
        // Previously established native accounts remain recoverable through
        // their original owner, not a new empty profile. An unused interrupted
        // old provider creation may finish with the new independent storage.
        if (access.rowCount || legacy.publicMetadata.pixlNativeSignup !== true
          || !isEligibleForInitialAccountSetup(legacy)) {
          await tx.query("COMMIT");
          return { status: "link_required" };
        }
      }
      const blocked = await tx.query(
        `SELECT 1 FROM admin_identity_blocks WHERE clerk_user_id=$1
         UNION ALL SELECT 1 FROM athlete_editor_access WHERE athlete_clerk_user_id=$1
         UNION ALL SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1`,
        [owner],
      );
      if (blocked.rowCount) throw new NativeLinkError(423, "This sign-in cannot create an iPhone profile.");
      await tx.query(
        "INSERT INTO native_accounts(owner_id,native_issuer,native_subject) VALUES($1,$2,$3)",
        [owner, who.issuer, who.subject],
      );
      await tx.query(
        `INSERT INTO account_access(owner_clerk_user_id,role,access_mode,lifecycle_status)
         VALUES($1,'fan','free','active')`, [owner],
      );
      await assertLinkableWebAccount(owner, tx);
      await tx.query(
        `INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
         VALUES($1,$2,$3,'PIXL Sports iPhone account')`,
        [who.issuer, who.subject, owner],
      );
      await tx.query("COMMIT");
      return { status: "ready" };
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  };
}
export const prepareNativeSupporterAccount = createNativeAccountPreparation();
