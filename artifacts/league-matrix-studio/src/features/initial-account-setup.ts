const ACCOUNT_SETUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROVISIONED_MARKER = "pixlSportsAccountProvisioned";
const LEGACY_PROFILE_KEYS = ["role", "accessMode", "displayName", "teamName", "athleteName", "seasonName"] as const;

type SetupIdentity = {
  createdAt?: unknown;
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

export function canShowInitialAccountSetup(identity: SetupIdentity | null | undefined, now = Date.now()) {
  if (!identity) return false;
  const createdAt = timestamp(identity.createdAt);
  if (createdAt === null || createdAt > now || now - createdAt > ACCOUNT_SETUP_WINDOW_MS) return false;

  if (asRecord(identity.publicMetadata)[PROVISIONED_MARKER] === true) return false;
  const unsafeMetadata = asRecord(identity.unsafeMetadata);
  return !LEGACY_PROFILE_KEYS.some((key) => {
    const value = unsafeMetadata[key];
    return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null && value !== false;
  });
}