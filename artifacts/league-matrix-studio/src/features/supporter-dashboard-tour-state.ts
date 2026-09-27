export type DashboardTourState = 'pending' | 'done' | null;

const tourProgressPrefix = 'pixlsports-dashboard-tour-progress:';

function tourProgressKey(userId: string) {
  return `${tourProgressPrefix}${encodeURIComponent(userId)}`;
}

export function readDashboardTourProgress(
  storage: Pick<Storage, 'getItem'> | null,
  userId: string | null | undefined,
  stepCount: number,
): number | null {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(tourProgressKey(userId));
    if (!raw) return null;
    const progress: unknown = JSON.parse(raw);
    if (typeof progress !== 'object' || progress === null || !('step' in progress)) return null;
    const step = progress.step;
    return typeof step === 'number' && Number.isInteger(step) && step >= 0 && step < stepCount ? step : null;
  } catch {
    return null;
  }
}

export function saveDashboardTourProgress(
  storage: Pick<Storage, 'setItem'> | null,
  userId: string | null | undefined,
  step: number,
) {
  if (!storage || !userId) return;
  try {
    storage.setItem(tourProgressKey(userId), JSON.stringify({ step }));
  } catch {
    // The tour still works while mounted if this browser blocks session storage.
  }
}

export function clearDashboardTourProgress(
  storage: Pick<Storage, 'removeItem'> | null,
  userId: string | null | undefined,
) {
  if (!storage || !userId) return;
  try {
    storage.removeItem(tourProgressKey(userId));
  } catch {
    // Completion remains saved in account metadata even without session storage.
  }
}

export function getDashboardTourState(metadata: unknown): DashboardTourState {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).dashboardTour;
  return value === 'pending' || value === 'done' ? value : null;
}

export function tourStateAfterSetup(metadata: unknown, alreadySetUp: boolean): DashboardTourState {
  const current = getDashboardTourState(metadata);
  return current ?? (alreadySetUp ? null : 'pending');
}