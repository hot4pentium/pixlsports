export type ScheduleEventType = 'game' | 'practice' | 'meeting';

export type ScheduleEvent = {
  id: string;
  type: ScheduleEventType;
  date: string;
  time: string;
  location: string;
  opponent: string;
  snacks: string;
  drinks: string;
  notes: string;
};

export type ScheduleDraft = {
  teamName: string;
  season: string;
  events: ScheduleEvent[];
  template: number;
};

export const scheduleStorageKey = 'leaguematrix-schedule-draft';

let scheduleEventCounter = 0;

export function createScheduleEvent(type: ScheduleEventType = 'game'): ScheduleEvent {
  scheduleEventCounter += 1;
  return {
    id: `schedule-event-${scheduleEventCounter}`,
    type,
    date: type === 'game' ? '2024-10-12' : '',
    time: type === 'game' ? '16:30' : '',
    location: type === 'game' ? 'Central Field' : '',
    opponent: type === 'game' ? 'Northside' : '',
    snacks: '',
    drinks: '',
    notes: '',
  };
}

export const defaultScheduleEvents: ScheduleEvent[] = [
  {
    ...createScheduleEvent('game'),
    id: 'schedule-event-default-1',
    snacks: 'Maya family',
    drinks: 'Jordan family',
  },
  {
    ...createScheduleEvent('practice'),
    id: 'schedule-event-default-2',
    date: '2024-10-13',
    time: '10:00',
    location: 'Eastside Field',
    notes: 'Bring cleats and a water bottle.',
  },
];

export function getDefaultScheduleEvents() {
  return defaultScheduleEvents.map((event) => ({ ...event }));
}

function isScheduleEventType(value: unknown): value is ScheduleEventType {
  return value === 'game' || value === 'practice' || value === 'meeting';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function normalizeScheduleEvent(
  value: unknown,
  fallbackId: string,
): ScheduleEvent {
  const input = typeof value === 'object' && value !== null
    ? value as Partial<ScheduleEvent>
    : {};
  const type = isScheduleEventType(input.type) ? input.type : 'game';

  return {
    id: stringValue(input.id) || fallbackId,
    type,
    date: stringValue(input.date),
    time: stringValue(input.time),
    location: stringValue(input.location),
    opponent: type === 'game' ? stringValue(input.opponent) : '',
    snacks: stringValue(input.snacks),
    drinks: stringValue(input.drinks),
    notes: stringValue(input.notes),
  };
}

export function normalizeScheduleDraft(value: unknown): ScheduleDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Partial<ScheduleDraft> & {
    title?: unknown;
    teamSeason?: unknown;
  };
  if (!Array.isArray(input.events)) return null;

  const legacyTeamSeason = stringValue(input.teamSeason);
  const separatorIndex = legacyTeamSeason.indexOf('·');
  const legacyTeamName = separatorIndex >= 0
    ? legacyTeamSeason.slice(0, separatorIndex).trim()
    : legacyTeamSeason.trim();
  const legacySeason = separatorIndex >= 0
    ? legacyTeamSeason.slice(separatorIndex + 1).trim()
    : '';

  return {
    teamName: stringValue(input.teamName) || legacyTeamName || stringValue(input.title) || 'Eastside Falcons',
    season: stringValue(input.season) || legacySeason || (legacyTeamSeason ? '' : 'Fall 2024'),
    events: input.events.map((event, index) => (
      normalizeScheduleEvent(event, `schedule-event-restored-${index + 1}`)
    )),
    template: typeof input.template === 'number' && Number.isFinite(input.template)
      ? input.template
      : 0,
  };
}

export function readScheduleDraft(storage: Storage = window.localStorage): ScheduleDraft | null {
  try {
    const stored = storage.getItem(scheduleStorageKey);
    if (!stored) return null;
    return normalizeScheduleDraft(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function saveScheduleDraft(storage: Storage, draft: ScheduleDraft) {
  storage.setItem(scheduleStorageKey, JSON.stringify(draft));
}

export function updateScheduleEvent(
  events: ScheduleEvent[],
  id: string,
  patch: Partial<ScheduleEvent>,
) {
  return events.map((event) => {
    if (event.id !== id) return event;

    if (patch.type && isScheduleEventType(patch.type)) {
      return {
        ...event,
        ...patch,
        type: patch.type,
        opponent: patch.type === 'game' ? (patch.opponent ?? event.opponent) : '',
      };
    }

    return { ...event, ...patch };
  });
}

export function addScheduleEvent(events: ScheduleEvent[], type: ScheduleEventType) {
  return [...events, createScheduleEvent(type)];
}

export function removeScheduleEvent(events: ScheduleEvent[], id: string) {
  return events.filter((event) => event.id !== id);
}

export function moveScheduleEvent(
  events: ScheduleEvent[],
  id: string,
  direction: -1 | 1,
) {
  const index = events.findIndex((event) => event.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= events.length) return events;

  const reordered = [...events];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  return reordered;
}