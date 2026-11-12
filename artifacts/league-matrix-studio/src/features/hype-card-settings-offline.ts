import type { OwnedAthleteInvite } from '@workspace/api-client-react';

export const HYPE_CARD_SETTINGS_FIELDS = ['showHypeCard', 'showStats', 'showEvents', 'paused'] as const;

export type HypeCardSettingsField = (typeof HYPE_CARD_SETTINGS_FIELDS)[number];

export type HypeCardSettings = Record<HypeCardSettingsField, boolean>;

export type PendingHypeCardSettings = {
  version: 1;
  accountId: string;
  inviteToken: string;
  savedAt: string;
  base: HypeCardSettings;
  desired: HypeCardSettings;
  editedFields: HypeCardSettingsField[];
};

const STORAGE_PREFIX = 'pixlsports:hype-card-settings:v1:';

function storageKey(accountId: string, inviteToken: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(inviteToken)}`;
}

export function hypeCardSettingsFromInvite(invite: Pick<OwnedAthleteInvite, HypeCardSettingsField>): HypeCardSettings {
  return {
    showHypeCard: invite.showHypeCard,
    showStats: invite.showStats,
    showEvents: invite.showEvents,
    paused: invite.paused,
  };
}

export function createPendingHypeCardSettings(
  accountId: string,
  inviteToken: string,
  base: HypeCardSettings,
  desired: HypeCardSettings,
  now = new Date().toISOString(),
): PendingHypeCardSettings {
  return {
    version: 1,
    accountId,
    inviteToken,
    savedAt: now,
    base: { ...base },
    desired: { ...desired },
    // Treat an explicit visibility edit as one atomic choice across conflicts.
    // Unrelated edits leave both legacy flags untouched.
    editedFields: HYPE_CARD_SETTINGS_FIELDS.filter((field) =>
      field === 'showHypeCard' || field === 'paused'
        ? base.showHypeCard !== desired.showHypeCard || base.paused !== desired.paused
        : base[field] !== desired[field]),
  };
}

function isSettings(value: unknown): value is HypeCardSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Record<string, unknown>;
  return HYPE_CARD_SETTINGS_FIELDS.every((field) => typeof settings[field] === 'boolean');
}

export function readPendingHypeCardSettings(
  storage: Pick<Storage, 'getItem'>,
  accountId: string,
  inviteToken: string,
): PendingHypeCardSettings | null {
  try {
    const value = JSON.parse(storage.getItem(storageKey(accountId, inviteToken)) ?? 'null') as Partial<PendingHypeCardSettings> | null;
    if (
      !value
      || value.version !== 1
      || value.accountId !== accountId
      || value.inviteToken !== inviteToken
      || typeof value.savedAt !== 'string'
      || !Number.isFinite(Date.parse(value.savedAt))
      || !isSettings(value.base)
      || !isSettings(value.desired)
      || !Array.isArray(value.editedFields)
      || !value.editedFields.every((field) => HYPE_CARD_SETTINGS_FIELDS.includes(field as HypeCardSettingsField))
    ) return null;
    return value as PendingHypeCardSettings;
  } catch {
    return null;
  }
}

export function savePendingHypeCardSettings(
  storage: Pick<Storage, 'setItem'>,
  pending: PendingHypeCardSettings,
) {
  storage.setItem(storageKey(pending.accountId, pending.inviteToken), JSON.stringify(pending));
}

export function clearPendingHypeCardSettings(
  storage: Pick<Storage, 'removeItem' | 'getItem'>,
  pending: PendingHypeCardSettings,
) {
  const key = storageKey(pending.accountId, pending.inviteToken);
  const current = readPendingHypeCardSettings(storage, pending.accountId, pending.inviteToken);
  if (current?.savedAt === pending.savedAt) storage.removeItem(key);
}

export function mergePendingHypeCardSettings(
  server: HypeCardSettings,
  pending: PendingHypeCardSettings,
): HypeCardSettings {
  const next = { ...server };
  for (const field of pending.editedFields) next[field] = pending.desired[field];
  return next;
}

export function retryWouldMakeHypeCardPublic(
  server: HypeCardSettings,
  desired: HypeCardSettings,
) {
  const wasPrivate = !server.showHypeCard || server.paused;
  const willBePublic = desired.showHypeCard && !desired.paused;
  return wasPrivate && willBePublic;
}
