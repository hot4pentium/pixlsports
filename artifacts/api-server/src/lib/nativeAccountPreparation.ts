import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { getAdminClerkClient } from "./adminAccess";
import { isEligibleForInitialAccountSetup, markAccountProvisioned } from "./accountProvisioning";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";
import { loadNativeSignupIdentity } from "./nativeSignupIdentity";
import { logger } from "./logger";

type Owner = {
  id: string; externalId: string | null; createdAt: number;
  publicMetadata: Record<string, unknown>; unsafeMetadata: Record<string, unknown>;
};
type Dependencies = {
  loadIdentity: typeof loadNativeSignupIdentity;
  findOwners: (externalId: string, emails: string[]) => Promise<Owner[]>;
  createOwner: (externalId: string, emails: string[]) => Promise<Owner>;
  markProvisioned: (owner: string) => Promise<void>;
};
const defaults: Dependencies = {
  loadIdentity: loadNativeSignupIdentity,
  async findOwners(externalId, emails) {
    const client = getAdminClerkClient();
    const [origin, addresses] = await Promise.all([
      client.users.getUserList({ externalId: [externalId], limit: 2 }),
      client.users.getUserList({ emailAddress: emails, limit: 100 }),
    ]);
    // A large/ambiguous result is not permission to create another account.
    if (addresses.totalCount > 100) throw new NativeLinkError(409, "Connect your existing PIXL account to continue.");
    return [...new Map([...origin.data, ...addresses.data].map(u => [u.id, u])).values()];
  },
  async createOwner(externalId, emails) {
    return getAdminClerkClient().users.createUser({
      externalId, emailAddress: emails, skipPasswordRequirement: true,
      publicMetadata: { pixlNativeSignup: true },
    });
  },
  markProvisioned: markAccountProvisioned,
};
export type NativeAccountPreparation = { status: "ready" | "link_required" };
export function nativeSignupExternalId(who: NativeIdentity) {
  return `pixl-ios:${createHash("sha256").update(JSON.stringify([who.issuer, who.subject])).digest("hex")}`;
}

export function createNativeAccountPreparation(deps: Dependencies = defaults) {
  return async (who: NativeIdentity): Promise<NativeAccountPreparation> => {
    const tx = await pool.connect();
    let provisionedOwner: string | undefined;
    try {
      await tx.query("BEGIN");
      // Same lock/order as explicit link approval, completion, and disconnect.
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
      const identity = await deps.loadIdentity(who);
      if (!identity.verifiedEmails.length) {
        throw new NativeLinkError(423, "Verify your email address before setting up your PIXL account.");
      }
      // Coordinate with web provisioning on the same normalized verified emails.
      for (const email of [...identity.verifiedEmails].sort()) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`account-provision-email:${email}`]);
      }
      const externalId = nativeSignupExternalId(who);
      const owners = await deps.findOwners(externalId, identity.verifiedEmails);
      // Email proves eligibility for a NEW account, never ownership of an old one.
      if (owners.some(o => o.externalId !== externalId) || owners.length > 1) {
        await tx.query("COMMIT");
        return { status: "link_required" };
      }
      if (!isEligibleForInitialAccountSetup({ createdAt: identity.createdAt })) {
        throw new NativeLinkError(423, "This sign-in needs account verification. Connect your existing PIXL account to continue.");
      }
      let owner = owners[0];
      if (owner) {
        const previous = await tx.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [owner.id]);
        // A deleted link must not be recreated automatically. The sole retry
        // exception is an interrupted creation that never committed app access.
        if (previous.rowCount || owner.publicMetadata.pixlNativeSignup !== true
          || !isEligibleForInitialAccountSetup(owner)) {
          await tx.query("COMMIT");
          return { status: "link_required" };
        }
      } else {
        owner = await deps.createOwner(externalId, identity.verifiedEmails);
      }
      const blocked = await tx.query(
        `SELECT 1 FROM admin_identity_blocks WHERE clerk_user_id=$1
         UNION ALL SELECT 1 FROM athlete_editor_access WHERE athlete_clerk_user_id=$1
         UNION ALL SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1`,
        [owner.id],
      );
      if (blocked.rowCount) throw new NativeLinkError(423, "This sign-in cannot create a new PIXL account.");
      await tx.query(
        `INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
         VALUES ($1,'fan','free','active')`, [owner.id],
      );
      await assertLinkableWebAccount(owner.id, tx);
      await tx.query(
        `INSERT INTO native_account_links (native_issuer,native_subject,owner_clerk_user_id,account_label)
         VALUES ($1,$2,$3,'PIXL Sports account')`,
        [who.issuer, who.subject, owner.id],
      );
      await tx.query("COMMIT");
      provisionedOwner = owner.id;
    } catch (error) {
      await tx.query("ROLLBACK");
      // A simultaneous provider-side email signup is not permission to merge.
      if (typeof error === "object" && error !== null && "errors" in error
        && Array.isArray(error.errors)
        && error.errors.some(e => e?.code === "form_identifier_exists")) {
        return { status: "link_required" };
      }
      throw error;
    } finally {
      tx.release();
    }
    if (provisionedOwner) {
      try { await deps.markProvisioned(provisionedOwner); }
      catch {
        // Access + mapping are already atomic and durable. A marker outage
        // must not strand the user or authorize recreating a revoked link.
        logger.warn("Could not persist the native account provisioning marker");
      }
    }
    return { status: "ready" };
  };
}
export const prepareNativeSupporterAccount = createNativeAccountPreparation();
