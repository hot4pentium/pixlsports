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
  shareToken?: string;
};

export type CloudScheduleProject = {
  id: string;
  name?: string;
  project: unknown;
  revision: number;
  updatedAt: string | Date;
};

export const scheduleStorageKey = 'leaguematrix-schedule-draft';
export const supporterScheduleSelectionStorageKey = 'leaguematrix-supporter-schedule-selection';

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

export function createBlankScheduleEvent(type: ScheduleEventType = 'game'): ScheduleEvent {
  scheduleEventCounter += 1;
  return {
    id: `schedule-event-${scheduleEventCounter}`,
    type,
    date: '',
    time: '',
    location: '',
    opponent: '',
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
  const shareToken = stringValue(input.shareToken);

  return {
    teamName: stringValue(input.teamName) || legacyTeamName || stringValue(input.title) || 'Eastside Falcons',
    season: stringValue(input.season) || legacySeason || (legacyTeamSeason ? '' : 'Fall 2024'),
    events: input.events.map((event, index) => (
      normalizeScheduleEvent(event, `schedule-event-restored-${index + 1}`)
    )),
    template: typeof input.template === 'number' && Number.isFinite(input.template)
      ? input.template
      : 0,
    ...(shareToken ? { shareToken } : {}),
  };
}

export function getLatestCloudScheduleProject(
  projects: readonly CloudScheduleProject[],
): CloudScheduleProject | null {
  return getCloudScheduleProjects(projects)[0] ?? null;
}

export function getCloudScheduleProjects(
  projects: readonly CloudScheduleProject[],
): CloudScheduleProject[] {
  return projects
    .filter((project) => (
      typeof project.project === 'object'
      && project.project !== null
      && !Array.isArray(project.project)
      && (project.project as { tool?: unknown }).tool === 'schedule'
      && Boolean(normalizeScheduleDraft(project.project))
    ))
    .sort((left, right) => (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    ));
}

export function getSelectedCloudScheduleProject(
  projects: readonly CloudScheduleProject[],
  selectedId?: string | null,
): CloudScheduleProject | null {
  const schedules = getCloudScheduleProjects(projects);
  return schedules.find((project) => project.id === selectedId) ?? schedules[0] ?? null;
}

export function readSupporterScheduleSelection(
  storage: Storage = window.localStorage,
): string | null {
  try {
    return storage.getItem(supporterScheduleSelectionStorageKey);
  } catch {
    return null;
  }
}

export function saveSupporterScheduleSelection(
  storage: Storage,
  projectId: string,
) {
  storage.setItem(supporterScheduleSelectionStorageKey, projectId);
}

export function clearSupporterScheduleSelection(
  storage: Storage = window.localStorage,
) {
  try {
    storage.removeItem(supporterScheduleSelectionStorageKey);
  } catch {
    // Storage can be unavailable in private browsing or during SSR.
  }
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
  return [...events, createBlankScheduleEvent(type)];
}

export function saveScheduleEvent(events: ScheduleEvent[], event: ScheduleEvent) {
  const existingIndex = events.findIndex((candidate) => candidate.id === event.id);
  if (existingIndex < 0) return [...events, event];

  return events.map((candidate, index) => (
    index === existingIndex ? event : candidate
  ));
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