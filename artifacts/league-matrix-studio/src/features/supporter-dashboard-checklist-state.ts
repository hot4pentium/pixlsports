export const SUPPORTER_DASHBOARD_CHECKLIST_ITEMS = [
  { id: 'profile', title: 'Setup Account Profile' },
  { id: 'shoutouts', title: 'Check out Shoutouts' },
  { id: 'hype-card', title: 'View Hype Card' },
  { id: 'event-card', title: 'Create an Event Card' },
  { id: 'install-app', title: 'Install as an app' },
] as const;

export type DashboardChecklistItemId =
  (typeof SUPPORTER_DASHBOARD_CHECKLIST_ITEMS)[number]['id'];

export type DashboardChecklistStatus = 'pending' | 'done' | null;

const itemIds = SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.map((item) => item.id);
const itemIdSet = new Set<string>(itemIds);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeDashboardChecklistItemIds(value: unknown): DashboardChecklistItemId[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.filter(
    (item): item is DashboardChecklistItemId => typeof item === 'string' && itemIdSet.has(item),
  ));
  return itemIds.filter((item): item is DashboardChecklistItemId => selected.has(item));
}

export function getDashboardChecklistItemIds(metadata: unknown): DashboardChecklistItemId[] {
  const checklist = asRecord(asRecord(metadata)?.dashboardChecklist);
  return normalizeDashboardChecklistItemIds(checklist?.checkedItemIds);
}

export function getDashboardChecklistStatus(metadata: unknown): DashboardChecklistStatus {
  const value = asRecord(metadata)?.dashboardTour;
  return value === 'pending' || value === 'done' ? value : null;
}

export function dashboardChecklistStateAfterSetup(
  metadata: unknown,
  alreadySetUp: boolean,
): DashboardChecklistStatus {
  const current = getDashboardChecklistStatus(metadata);
  return current ?? (alreadySetUp ? null : 'pending');
}

export function isDashboardChecklistComplete(value: unknown): boolean {
  return normalizeDashboardChecklistItemIds(value).length === SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.length;
}