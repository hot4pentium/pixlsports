import { createClerkClient } from "@clerk/express";

const ACCOUNT_SETUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROVISIONED_MARKER = "pixlSportsAccountProvisioned";
const LEGACY_PROFILE_KEYS = ["role", "accessMode", "displayName", "teamName", "athleteName", "seasonName"] as const;

type ClerkIdentitySnapshot = {
  createdAt: unknown;
  publicMetadata?: unknown;
  unsafeMetadata?: unknown;
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

export async function canProvisionInitialAccount(ownerClerkUserId: string) {
  const clerk = getClerkClient();
  try {
    const identity = await clerk.users.getUser(ownerClerkUserId);
    return isEligibleForInitialAccountSetup(identity);
  } catch (error) {
    if (isClerkNotFound(error)) return false;
    throw error;
  }
}

export async function markAccountProvisioned(ownerClerkUserId: string) {
  const clerk = getClerkClient();
  const user = await clerk.users.getUser(ownerClerkUserId);
  const publicMetadata = asRecord(user.publicMetadata);
  if (publicMetadata[PROVISIONED_MARKER] === true) return;

  await clerk.users.updateUserMetadata(ownerClerkUserId, {
    publicMetadata: {
      ...publicMetadata,
      [PROVISIONED_MARKER]: true,
    },
  });
}