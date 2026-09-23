export type MeetingParticipant = {
  id: string;
  name: string;
  role: string;
  present: boolean;
};

export type MeetingAgendaItem = {
  id: string;
  label: string;
  completed: boolean;
};

export type MeetingDecision = {
  id: string;
  text: string;
};

export type MeetingFollowUp = {
  id: string;
  task: string;
  owner: string;
  dueDate: string;
};

export type MeetingContext = {
  id: string;
  date: string;
  time: string;
  location: string;
  title: string;
};

export type MeetingState = {
  notes: string;
  participants: MeetingParticipant[];
  agenda: MeetingAgendaItem[];
  decisions: MeetingDecision[];
  followUps: MeetingFollowUp[];
  startedAt: string | null;
  endedAt: string | null;
  context?: MeetingContext;
};

export type LocalMeetingRecord = {
  key: string;
  context: MeetingContext;
  state: MeetingState;
};

export const meetingStoragePrefix = 'pixlsports-meeting-capture';

export function meetingStorageKey(scope: string, meetingId: string) {
  return `${meetingStoragePrefix}:${scope}:${meetingId}`;
}

function parseEventTime(value: string): { hour: number; minute: number } | null {
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return { hour: (hour % 12) + (twelveHour[3].toUpperCase() === 'PM' ? 12 : 0), minute };
  }

  const twentyFourHour = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!twentyFourHour) return null;
  const hour = Number(twentyFourHour[1]);
  const minute = Number(twentyFourHour[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function isMeetingScheduledToStart(context: Pick<MeetingContext, 'date' | 'time'>, now = new Date()) {
  if (!context.date || !context.time) return false;
  const eventTime = parseEventTime(context.time);
  if (!eventTime) return false;
  const start = new Date(`${context.date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return false;
  start.setHours(eventTime.hour, eventTime.minute, 0, 0);
  return start.getTime() <= now.getTime();
}

export function getMeetingPhase(
  context: Pick<MeetingContext, 'date' | 'time'>,
  state: Pick<MeetingState, 'startedAt' | 'endedAt'>,
  now = new Date(),
): 'prep' | 'live' | 'share' {
  if (state.endedAt) return 'share';
  if (state.startedAt || isMeetingScheduledToStart(context, now)) return 'live';
  return 'prep';
}

export function normalizeMeetingState(value: unknown): MeetingState | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Partial<MeetingState>;
  if (!Array.isArray(input.participants) || !Array.isArray(input.agenda)) return null;

  const participants = input.participants
    .filter((item): item is MeetingParticipant => (
      typeof item === 'object'
      && item !== null
      && typeof (item as MeetingParticipant).id === 'string'
      && typeof (item as MeetingParticipant).name === 'string'
    ))
    .slice(0, 100)
    .map((item) => ({
      id: item.id,
      name: item.name.trim() || 'Unnamed attendee',
      role: typeof item.role === 'string' ? item.role : '',
      present: Boolean(item.present),
    }));
  const agenda = input.agenda
    .filter((item): item is MeetingAgendaItem => (
      typeof item === 'object'
      && item !== null
      && typeof (item as MeetingAgendaItem).id === 'string'
      && typeof (item as MeetingAgendaItem).label === 'string'
    ))
    .slice(0, 100)
    .map((item) => ({
      id: item.id,
      label: item.label.trim() || 'Untitled agenda item',
      completed: Boolean(item.completed),
    }));
  const decisions = Array.isArray(input.decisions)
    ? input.decisions
      .filter((item): item is MeetingDecision => (
        typeof item === 'object'
        && item !== null
        && typeof (item as MeetingDecision).id === 'string'
        && typeof (item as MeetingDecision).text === 'string'
      ))
      .slice(0, 100)
      .map((item) => ({ id: item.id, text: item.text }))
    : [];
  const followUps = Array.isArray(input.followUps)
    ? input.followUps
      .filter((item): item is MeetingFollowUp => (
        typeof item === 'object'
        && item !== null
        && typeof (item as MeetingFollowUp).id === 'string'
        && typeof (item as MeetingFollowUp).task === 'string'
      ))
      .slice(0, 100)
      .map((item) => ({
        id: item.id,
        task: item.task,
        owner: typeof item.owner === 'string' ? item.owner : '',
        dueDate: typeof item.dueDate === 'string' ? item.dueDate : '',
      }))
    : [];
  const context = typeof input.context === 'object' && input.context !== null
    && typeof (input.context as MeetingContext).id === 'string'
    ? {
      id: (input.context as MeetingContext).id,
      date: typeof (input.context as MeetingContext).date === 'string' ? (input.context as MeetingContext).date : '',
      time: typeof (input.context as MeetingContext).time === 'string' ? (input.context as MeetingContext).time : '',
      location: typeof (input.context as MeetingContext).location === 'string' ? (input.context as MeetingContext).location : '',
      title: typeof (input.context as MeetingContext).title === 'string' ? (input.context as MeetingContext).title : 'Team meeting',
    }
    : undefined;

  return {
    notes: typeof input.notes === 'string' ? input.notes : '',
    participants,
    agenda,
    decisions,
    followUps,
    startedAt: typeof input.startedAt === 'string' ? input.startedAt : null,
    endedAt: typeof input.endedAt === 'string' ? input.endedAt : null,
    ...(context ? { context } : {}),
  };
}

export function readMeetingState(storage: Pick<Storage, 'getItem'>, key: string): MeetingState | null {
  try {
    const raw = storage.getItem(key);
    return raw ? normalizeMeetingState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function listCompletedMeetingRecords(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  scope: string,
  events: readonly {
    id: string;
    date: string;
    time: string;
    location: string;
    opponent?: string;
    type: 'game' | 'practice' | 'meeting';
  }[] = [],
): LocalMeetingRecord[] {
  const prefix = `${meetingStoragePrefix}:${scope}:`;
  const records: LocalMeetingRecord[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(prefix)) continue;
    const state = readMeetingState(storage, key);
    if (!state?.endedAt) continue;
    const meetingId = key.slice(prefix.length);
    const event = events.find((candidate) => candidate.id === meetingId);
    const context = state.context ?? {
      id: meetingId,
      date: event?.date ?? '',
      time: event?.time ?? '',
      location: event?.location ?? '',
      title: event?.opponent?.trim() || 'Team meeting',
    };
    records.push({ key, context, state });
  }
  return records.sort((left, right) => {
    const leftDate = Date.parse(left.state.endedAt || '') || 0;
    const rightDate = Date.parse(right.state.endedAt || '') || 0;
    return rightDate - leftDate;
  });
}