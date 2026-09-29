import type { AccountAccess, AccountLifecycle, Project } from '@workspace/api-client-react';

const CACHE_PREFIX = 'pixl-sports:private-dashboard:v1:';
const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type OfflineDashboardSnapshot = {
  version: 1;
  accountId: string;
  verifiedAt: string;
  lifecycle: AccountLifecycle;
  accountAccess?: AccountAccess;
  projects?: Project[];
};

function keyFor(accountId: string) {
  return `${CACHE_PREFIX}${encodeURIComponent(accountId)}`;
}

function isLifecycle(value: unknown): value is AccountLifecycle {
  if (!value || typeof value !== 'object') return false;
  const lifecycle = value as Partial<AccountLifecycle>;
  return lifecycle.status === 'active'
    || lifecycle.status === 'paused'
    || lifecycle.status === 'cancelled'
    || lifecycle.status === 'deletion_pending';
}

export function readOfflineDashboardSnapshot(
  storage: Pick<Storage, 'getItem'>,
  accountId: string,
  now = Date.now(),
): OfflineDashboardSnapshot | null {
  try {
    const value = JSON.parse(storage.getItem(keyFor(accountId)) ?? 'null') as Partial<OfflineDashboardSnapshot> | null;
    if (
      !value
      || value.version !== 1
      || value.accountId !== accountId
      || typeof value.verifiedAt !== 'string'
      || !Number.isFinite(Date.parse(value.verifiedAt))
      || now - Date.parse(value.verifiedAt) > MAX_SNAPSHOT_AGE_MS
      || !isLifecycle(value.lifecycle)
    ) return null;
    return value as OfflineDashboardSnapshot;
  } catch {
    return null;
  }
}

export function updateOfflineDashboardSnapshot(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  accountId: string,
  patch: Partial<Omit<OfflineDashboardSnapshot, 'version' | 'accountId'>>,
): OfflineDashboardSnapshot | null {
  const existing = readOfflineDashboardSnapshot(storage, accountId);
  const lifecycle = patch.lifecycle ?? existing?.lifecycle;
  if (!lifecycle) return null;
  const snapshot: OfflineDashboardSnapshot = {
    version: 1,
    accountId,
    verifiedAt: patch.verifiedAt ?? existing?.verifiedAt ?? new Date().toISOString(),
    lifecycle,
    ...(patch.accountAccess ?? existing?.accountAccess
      ? { accountAccess: patch.accountAccess ?? existing?.accountAccess }
      : {}),
    ...(patch.projects ?? existing?.projects
      ? { projects: patch.projects ?? existing?.projects }
      : {}),
  };
  storage.setItem(keyFor(accountId), JSON.stringify(snapshot));
  return snapshot;
}

export function clearOfflineDashboardSnapshot(
  storage: Pick<Storage, 'removeItem'>,
  accountId: string,
) {
  storage.removeItem(keyFor(accountId));
}

export function clearPrivateOfflineAccountData(storage: Storage, accountId: string) {
  const encodedAccountId = encodeURIComponent(accountId);
  const accountMarkers = [`:${accountId}`, `:${encodedAccountId}`];
  const unscopedPrivateKeys = new Set([
    'leaguematrix-supporter-active-game',
    'leaguematrix-workspace-event-context',
    'leaguematrix-supporter-schedule-selection',
  ]);
  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const isPixlSportsData = key.startsWith('pixl') || key.startsWith('leaguematrix');
    if (
      unscopedPrivateKeys.has(key)
      || (isPixlSportsData && accountMarkers.some((marker) => key.includes(marker)))
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => storage.removeItem(key));
}

export function offlineDashboardStorageKey(accountId: string) {
  return keyFor(accountId);
}