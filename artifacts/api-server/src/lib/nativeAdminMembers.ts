import { eq } from "drizzle-orm";
import { db, nativeAccountsTable, nativeAccountLinksTable } from "@workspace/db";
import { isNativeProfileOwner } from "./nativeOwnerMetadata";
import { loadNativeProviderIdentity } from "./nativeSignupIdentity";

export type AdminDirectoryUser = {
  id: string;
  createdAt: number;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string }[];
  firstName: string | null;
  lastName: string | null;
  unsafeMetadata: unknown;
  accountSource?: "pwa" | "native_ios" | "legacy_linked";
  providerIdentityStatus?: "available" | "unavailable";
};

/** The database owner, never email or the native subject, is the action target. */
export async function nativeAdminUser(
  row: typeof nativeAccountsTable.$inferSelect,
  loadIdentity = loadNativeProviderIdentity,
): Promise<AdminDirectoryUser> {
  const base: AdminDirectoryUser = {
    id: row.ownerId,
    createdAt: row.createdAt.getTime(),
    primaryEmailAddressId: null,
    emailAddresses: [],
    firstName: null,
    lastName: null,
    unsafeMetadata: row.profileMetadata,
    accountSource: "native_ios",
    providerIdentityStatus: "unavailable",
  };
  try {
    const identity = await loadIdentity({ issuer: row.nativeIssuer, subject: row.nativeSubject });
    // Keep the identity check here as well for injected providers and future adapters.
    if (identity.id !== row.nativeSubject) return base;
    return {
      ...base,
      firstName: identity.first_name ?? null,
      lastName: identity.last_name ?? null,
      primaryEmailAddressId: identity.primary_email_address_id,
      emailAddresses: identity.email_addresses.map(email => ({
        id: email.id, emailAddress: email.email_address,
      })),
      providerIdentityStatus: "available",
    };
  } catch {
    // Keep account restrictions manageable during provider outages. The UI
    // explicitly distinguishes unavailable identity data from a missing email.
    return base;
  }
}

export async function getNativeAdminUser(owner: string) {
  if (!isNativeProfileOwner(owner)) return null;
  const [row] = await db.select().from(nativeAccountsTable).where(eq(nativeAccountsTable.ownerId, owner)).limit(1);
  return row ? nativeAdminUser(row) : null;
}

export async function memberAccountSource(owner: string) {
  if (isNativeProfileOwner(owner)) return "native_ios" as const;
  const [link] = await db.select({ id: nativeAccountLinksTable.id }).from(nativeAccountLinksTable)
    .where(eq(nativeAccountLinksTable.ownerClerkUserId, owner)).limit(1);
  return link ? "legacy_linked" as const : "pwa" as const;
}
