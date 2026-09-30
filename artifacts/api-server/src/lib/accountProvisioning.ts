import { createClerkClient } from "@clerk/express";

const ACCOUNT_SETUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROVISIONED_MARKER = "pixlSportsAccountProvisioned";
const LEGACY_PROFILE_KEYS = ["role", "accessMode", "displayName", "teamName", "athleteName", "seasonName"] as const;

type ClerkIdentitySnapshot = {
  id?: unknown;
  createdAt: unknown;
  publicMetadata?: unknown;
  unsafeMetadata?: unknown;
  emailAddresses?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timestamp(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isEligibleForInitialAccountSetup(
  identity: ClerkIdentitySnapshot,
  now = Date.now(),
) {
  const createdAt = timestamp(identity.createdAt);
  if (createdAt === null || createdAt > now || now - createdAt > ACCOUNT_SETUP_WINDOW_MS) return false;

  const publicMetadata = asRecord(identity.publicMetadata);
  if (publicMetadata[PROVISIONED_MARKER] === true) return false;

  const unsafeMetadata = asRecord(identity.unsafeMetadata);
  return !LEGACY_PROFILE_KEYS.some((key) => {
    const value = unsafeMetadata[key];
    return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null && value !== false;
  });
}

function getVerifiedEmailAddresses(identity: ClerkIdentitySnapshot): string[] {
  if (!Array.isArray(identity.emailAddresses)) return [];

  const addresses = new Set<string>();
  for (const candidate of identity.emailAddresses) {
    const emailAddress = asRecord(candidate);
    const verification = asRecord(emailAddress.verification);
    if (verification.status !== "verified" || typeof emailAddress.emailAddress !== "string") continue;

    const normalizedAddress = emailAddress.emailAddress.trim().toLowerCase();
    if (normalizedAddress) addresses.add(normalizedAddress);
  }

  return [...addresses];
}

function getClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required to verify account setup");
  return createClerkClient({ secretKey });
}

function isClerkNotFound(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && (error as { status?: unknown }).status === 404;
}

export type AccountProvisioningClerkClient = ReturnType<typeof createClerkClient>;

export function createAccountProvisioning(getClient: () => AccountProvisioningClerkClient) {
  async function getInitialAccountSetup(ownerClerkUserId: string) {
    const clerk = getClient();
    try {
      const identity = await clerk.users.getUser(ownerClerkUserId);
      return {
        eligible: isEligibleForInitialAccountSetup(identity),
        verifiedEmails: getVerifiedEmailAddresses(identity),
      };
    } catch (error) {
      if (isClerkNotFound(error)) return { eligible: false, verifiedEmails: [] };
      throw error;
    }
  }

  return {
    async canProvisionInitialAccount(ownerClerkUserId: string) {
      return (await getInitialAccountSetup(ownerClerkUserId)).eligible;
    },

    getInitialAccountSetup,

    async getClerkUserIdsByVerifiedEmails(emailAddresses: string[]) {
      const clerk = getClient();
      const normalizedAddresses = [...new Set(emailAddresses
        .map((address) => address.trim().toLowerCase())
        .filter(Boolean))];
      const userIds = new Set<string>();
      const addressChunkSize = 100;

      for (let start = 0; start < normalizedAddresses.length; start += addressChunkSize) {
        const addressChunk = normalizedAddresses.slice(start, start + addressChunkSize);
        const matchingAddresses = new Set(addressChunk);
        let offset = 0;
        let totalCount = Number.POSITIVE_INFINITY;

        while (offset < totalCount) {
          const page = await clerk.users.getUserList({
            emailAddress: addressChunk,
            limit: 500,
            offset,
          });
          totalCount = page.totalCount;
          if (page.data.length === 0) break;

          for (const user of page.data) {
            const identity = user as unknown as ClerkIdentitySnapshot;
            const hasMatchingVerifiedAddress = getVerifiedEmailAddresses(identity)
              .some((address) => matchingAddresses.has(address));
            if (hasMatchingVerifiedAddress) userIds.add(user.id);
          }

          offset += page.data.length;
        }
      }

      return [...userIds];
    },

    async markAccountProvisioned(ownerClerkUserId: string) {
      const clerk = getClient();
      const user = await clerk.users.getUser(ownerClerkUserId);
      const publicMetadata = asRecord(user.publicMetadata);
      if (publicMetadata[PROVISIONED_MARKER] === true) return;

      await clerk.users.updateUserMetadata(ownerClerkUserId, {
        publicMetadata: {
          ...publicMetadata,
          [PROVISIONED_MARKER]: true,
        },
      });
    },
  };
}

const accountProvisioning = createAccountProvisioning(getClerkClient);

export const canProvisionInitialAccount = accountProvisioning.canProvisionInitialAccount;
export const getInitialAccountSetup = accountProvisioning.getInitialAccountSetup;
export const getClerkUserIdsByVerifiedEmails = accountProvisioning.getClerkUserIdsByVerifiedEmails;
export const markAccountProvisioned = accountProvisioning.markAccountProvisioned;