export type ScheduleEventType = 'game' | 'practice' | 'meeting';
export type ScheduleEventStatus = 'upcoming' | 'live' | 'final';

export type ScheduleEvent = {
  id: string;
  type: ScheduleEventType;
  status?: ScheduleEventStatus;
  completedAt?: string;
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
export const scheduleLegacyDefaultsMigrationKey = 'leaguematrix-schedule-defaults-migrated';
export const supporterScheduleSelectionStorageKey = 'leaguematrix-supporter-schedule-selection';

let scheduleEventCounter = 0;

export function createScheduleEvent(type: ScheduleEventType = 'game'): ScheduleEvent {
  scheduleEventCounter += 1;
  return {
    id: `schedule-event-${scheduleEventCounter}`,
    type,
    ...(type === 'game' ? { status: 'upcoming' as const } : {}),
    date: '',
    time: '',
    location: '',
    opponent: '',
    snacks: '',
    drinks: '',
    notes: '',
  };
}

export function createBlankScheduleEvent(type: ScheduleEventType = 'game'): ScheduleEvent {
  return createScheduleEvent(type);
}

const legacyDefaultScheduleEvents: ScheduleEvent[] = [
  {
    id: 'schedule-event-default-1',
    type: 'game',
    date: '2024-10-12',
    time: '16:30',
    location: 'Central Field',
    opponent: 'Northside',
    snacks: 'Maya family',
    drinks: 'Jordan family',
    notes: '',
  },
  {
    id: 'schedule-event-default-2',
    type: 'practice',
    date: '2024-10-13',
    time: '10:00',
    location: 'Eastside Field',
    opponent: '',
    snacks: '',
    drinks: '',
    notes: 'Bring cleats and a water bottle.',
  },
];

export const defaultScheduleEvents: ScheduleEvent[] = [];

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
    ...(type === 'game' && (
      input.status === 'upcoming'
      || input.status === 'live'
      || input.status === 'final'
    ) ? { status: input.status } : {}),
    ...(type === 'game' && stringValue(input.completedAt)
      ? { completedAt: stringValue(input.completedAt) }
      : {}),
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
    teamName: stringValue(input.teamName) || legacyTeamName || stringValue(input.title) || '',
    season: stringValue(input.season) || legacySeason || '',
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

export function normalizeScheduleIdentityPart(value: unknown): string {
  return stringValue(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function getScheduleIdentity(
  draft: Pick<ScheduleDraft, 'teamName' | 'season'>,
): string | null {
  const teamName = normalizeScheduleIdentityPart(draft.teamName);
  const season = normalizeScheduleIdentityPart(draft.season);
  return teamName && season ? `${teamName}::${season}` : null;
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

export function getCloudScheduleProjectForIdentity(
  projects: readonly CloudScheduleProject[],
  identity: Pick<ScheduleDraft, 'teamName' | 'season'>,
): CloudScheduleProject | null {
  const targetIdentity = getScheduleIdentity(identity);
  if (!targetIdentity) return null;

  return getCloudScheduleProjects(projects).find((project) => {
    const draft = normalizeScheduleDraft(project.project);
    return draft ? getScheduleIdentity(draft) === targetIdentity : false;
  }) ?? null;
}

export function getActiveCloudScheduleProject(
  projects: readonly CloudScheduleProject[],
  identity?: Pick<ScheduleDraft, 'teamName' | 'season'> | null,
): CloudScheduleProject | null {
  if (identity && getScheduleIdentity(identity)) {
    return getCloudScheduleProjectForIdentity(projects, identity)
      ?? getLatestCloudScheduleProject(projects);
  }

  return getLatestCloudScheduleProject(projects);
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
    if (storage.getItem(scheduleLegacyDefaultsMigrationKey) !== '1') {
      storage.setItem(scheduleLegacyDefaultsMigrationKey, '1');
      if (stored) {
        const draft = normalizeScheduleDraft(JSON.parse(stored));
        if (draft && isLegacyDefaultScheduleDraft(draft)) {
          storage.removeItem(scheduleStorageKey);
          return null;
        }
        return draft;
      }
      return null;
    }
    if (!stored) return null;
    return normalizeScheduleDraft(JSON.parse(stored));
  } catch {
    return null;
  }
}

function isLegacyDefaultScheduleDraft(draft: ScheduleDraft) {
  if (
    draft.teamName !== 'Eastside Falcons'
    || draft.season !== 'Fall 2024'
    || draft.events.length !== legacyDefaultScheduleEvents.length
  ) {
    return false;
  }

  return draft.events.every((event, index) => {
    const legacyEvent = legacyDefaultScheduleEvents[index];
    return Boolean(legacyEvent)
      && event.id === legacyEvent.id
      && event.type === legacyEvent.type
      && event.date === legacyEvent.date
      && event.time === legacyEvent.time
      && event.location === legacyEvent.location
      && event.opponent === legacyEvent.opponent
      && event.snacks === legacyEvent.snacks
      && event.drinks === legacyEvent.drinks
      && event.notes === legacyEvent.notes
      && event.status === legacyEvent.status;
  });
}

export function saveScheduleDraft(storage: Storage, draft: ScheduleDraft) {
  storage.setItem(scheduleStorageKey, JSON.stringify(draft));
}

export function createScheduleAutosaveQueue() {
  let previousSave: Promise<unknown> = Promise.resolve();

  return {
    enqueue<T>(save: () => Promise<T>): Promise<T> {
      const nextSave = previousSave.then(save, save);
      previousSave = nextSave.then(
        () => undefined,
        () => undefined,
      );
      return nextSave;
    },
  };
}

export function updateScheduleEvent(
  events: ScheduleEvent[],
  id: string,
  patch: Partial<ScheduleEvent>,
) {
  return events.map((event) => {
    if (event.id !== id) return event;

    if (patch.type && isScheduleEventType(patch.type)) {
      const nextType = patch.type;
      return {
        ...event,
        ...patch,
        type: nextType,
        ...(nextType === 'game'
          ? (patch.status ?? event.status ? { status: patch.status ?? event.status } : {})
          : {}),
        ...(nextType !== 'game' ? { status: undefined } : {}),
        opponent: nextType === 'game' ? (patch.opponent ?? event.opponent) : '',
      };
    }

    return { ...event, ...patch };
  });
}

export function updateScheduleEventStatus(
  events: ScheduleEvent[],
  id: string,
  status: ScheduleEventStatus,
  completedAt?: string,
) {
  return events.map((event) => (
    event.id === id && event.type === 'game'
      ? {
        ...event,
        status,
        ...(status === 'final' && completedAt ? { completedAt } : {}),
        ...(status !== 'final' ? { completedAt: undefined } : {}),
      }
      : event
  ));
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