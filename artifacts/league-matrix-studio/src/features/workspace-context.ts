import type { ScheduleEvent } from './schedule-draft';

export const workspaceEventContextStorageKey = 'pixlsports-workspace-event-context';

export type WorkspaceEventContext = Pick<
  ScheduleEvent,
  'id' | 'type' | 'date' | 'time' | 'location' | 'opponent'
>;

export function toWorkspaceEventContext(event: ScheduleEvent): WorkspaceEventContext {
  return {
    id: event.id,
    type: event.type,
    date: event.date,
    time: event.time,
    location: event.location,
    opponent: event.opponent,
  };
}

export function saveWorkspaceEventContext(
  storage: Pick<Storage, 'setItem'>,
  event: ScheduleEvent,
) {
  if (event.type === 'meeting') return;
  storage.setItem(workspaceEventContextStorageKey, JSON.stringify(toWorkspaceEventContext(event)));
}

export function readWorkspaceEventContext(
  storage: Pick<Storage, 'getItem'>,
): WorkspaceEventContext | null {
  try {
    const value = JSON.parse(storage.getItem(workspaceEventContextStorageKey) ?? 'null') as Partial<WorkspaceEventContext> | null;
    if (
      !value
      || typeof value.id !== 'string'
      || (value.type !== 'game' && value.type !== 'practice')
    ) return null;
    return {
      id: value.id,
      type: value.type,
      date: typeof value.date === 'string' ? value.date : '',
      time: typeof value.time === 'string' ? value.time : '',
      location: typeof value.location === 'string' ? value.location : '',
      opponent: value.type === 'game' && typeof value.opponent === 'string' ? value.opponent : '',
    };
  } catch {
    return null;
  }
}

export function resolveWorkspaceEvent<T extends WorkspaceEventContext>(
  events: readonly T[],
  stored: WorkspaceEventContext | null,
): T | undefined {
  if (!stored) return undefined;
  return events.find((event) => event.id === stored.id);
}

export function buildWorkspaceToolHref(
  tool: 'calendar' | 'prep' | 'stats' | 'hype',
  event?: WorkspaceEventContext,
): string {
  if (tool === 'calendar') {
    return event ? `/studio/schedule?eventId=${encodeURIComponent(event.id)}` : '/studio/schedule';
  }
  if (tool === 'prep') {
    return event
      ? `/studio/checklist?gameId=${encodeURIComponent(event.id)}&eventType=${encodeURIComponent(event.type)}`
      : '/studio/checklist';
  }

  const route = tool === 'stats' ? '/studio/stat-tracker' : '/studio/athlete-page';
  if (tool === 'hype' || !event) return route;
  const search = new URLSearchParams({
    source: 'workspace',
    eventId: event.id,
    eventType: event.type,
    date: event.date,
  });
  if (event.opponent) search.set('opponent', event.opponent);
  return `${route}?${search.toString()}`;
}