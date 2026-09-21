import type { ScheduleShare } from '@workspace/api-client-react';

export type ScheduleShareView = ScheduleShare & {
  cacheStatus: 'fresh' | 'cached';
  refreshFailed: boolean;
};

type StoredScheduleShare = {
  schedule: ScheduleShare;
  savedAt: string;
};

const scheduleCacheKeyPrefix = 'pixl-sports:schedule-share:';

function getStorageKey(shareToken: string) {
  return `${scheduleCacheKeyPrefix}${shareToken}`;
}

function readStoredSchedule(shareToken: string): StoredScheduleShare | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  try {
    const value = JSON.parse(window.localStorage.getItem(getStorageKey(shareToken)) ?? 'null') as Partial<StoredScheduleShare> | null;
    if (
      !value ||
      typeof value !== 'object' ||
      !value.schedule ||
      typeof value.schedule !== 'object' ||
      typeof value.schedule.shareToken !== 'string' ||
      value.schedule.shareToken !== shareToken
    ) {
      return null;
    }
    return value as StoredScheduleShare;
  } catch {
    return null;
  }
}

function storeSchedule(schedule: ScheduleShare) {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    const value: StoredScheduleShare = {
      schedule,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(getStorageKey(schedule.shareToken), JSON.stringify(value));
  } catch {
    // The service worker cache remains the primary offline store when storage is unavailable.
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

class ScheduleShareUnavailableError extends Error {
  readonly status = 404;
}

export async function fetchScheduleShareWithCache(
  shareToken: string,
  signal?: AbortSignal,
): Promise<ScheduleShareView> {
  const stored = readStoredSchedule(shareToken);

  try {
    const response = await fetch(`/api/schedule-shares/${encodeURIComponent(shareToken)}`, {
      signal,
      headers: { accept: 'application/json' },
    });

    if (response.status === 404) {
      throw new ScheduleShareUnavailableError('Schedule share not found');
    }
    if (!response.ok) {
      throw new Error(`Schedule refresh failed with HTTP ${response.status}`);
    }

    const schedule = await response.json() as ScheduleShare;
    const servedFromServiceWorkerCache = response.headers.get('x-pixl-schedule-cache') === 'offline';
    if (!servedFromServiceWorkerCache) {
      storeSchedule(schedule);
    }

    return {
      ...schedule,
      cacheStatus: servedFromServiceWorkerCache ? 'cached' : 'fresh',
      refreshFailed: servedFromServiceWorkerCache,
    };
  } catch (error) {
    if (isAbortError(error) || error instanceof ScheduleShareUnavailableError) {
      throw error;
    }

    if (stored) {
      return {
        ...stored.schedule,
        cacheStatus: 'cached',
        refreshFailed: true,
      };
    }

    throw error;
  }
}