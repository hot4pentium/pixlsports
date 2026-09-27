export type DashboardTourState = 'pending' | 'done' | null;

export function getDashboardTourState(metadata: unknown): DashboardTourState {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).dashboardTour;
  return value === 'pending' || value === 'done' ? value : null;
}

export function tourStateAfterSetup(metadata: unknown, alreadySetUp: boolean): DashboardTourState {
  const current = getDashboardTourState(metadata);
  return current ?? (alreadySetUp ? null : 'pending');
}