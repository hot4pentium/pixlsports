import type { SupporterProfile } from './supporter-dashboard';
import { getShowcaseInviteReconnectionCandidates } from './player-showcase-model';
import { isSport, type Sport } from './stat-tracker';
import type { ScheduleEventStatus } from './schedule-draft';
import { hypeCardProjectStorageKey, type HypeCardProject } from './hype-card-types';
import {
  getSupporterEventLocalDateKey,
  getSupporterEventStart,
  normalizeSupporterEventDateKey,
} from './supporter-event-time';

/** The studio is supporter-first. Legacy role metadata is intentionally normalized. */
export type UserRole = 'fan';
export type AccessMode = 'full' | 'guest';

export interface UserProfile {
  role: UserRole | null;
  displayName: string;
  teamName: string;
  seasonName: string;
  accessMode: AccessMode | null;
  athleteName: string;
  jerseyNumber: string;
  position: string;
  relationship: string;
  sport: Sport | null;
}

export type UserLike = {
  firstName?: string | null;
  lastName?: string | null;
  unsafeMetadata?: unknown;
} | null | undefined;

export function getUserRole(user: UserLike): UserRole | null {
  const role = typeof user?.unsafeMetadata === 'object' && user.unsafeMetadata !== null
    ? (user.unsafeMetadata as { role?: unknown }).role
    : null;
  return role === ['c', 'oach'].join('') || role === 'fan' ? 'fan' : null;
}

export function getUserProfile(user: UserLike): UserProfile {
  const metadata = typeof user?.unsafeMetadata === 'object' && user.unsafeMetadata !== null
    ? user.unsafeMetadata as Record<string, unknown>
    : {};
  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  const role: UserRole | null = metadata.role === ['c', 'oach'].join('') || metadata.role === 'fan' ? 'fan' : null;

  return {
    role,
    displayName: typeof metadata.displayName === 'string' && metadata.displayName.trim()
      ? metadata.displayName.trim()
      : clerkName,
    teamName: typeof metadata.teamName === 'string' ? metadata.teamName.trim() : '',
    seasonName: typeof metadata.seasonName === 'string' ? metadata.seasonName.trim() : '',
    accessMode: metadata.accessMode === 'guest' || metadata.accessMode === 'full'
      ? metadata.accessMode
      : role ? 'full' : null,
    athleteName: typeof metadata.athleteName === 'string' ? metadata.athleteName.trim() : '',
    jerseyNumber: typeof metadata.jerseyNumber === 'string' ? metadata.jerseyNumber.trim() : '',
    position: typeof metadata.position === 'string' ? metadata.position.trim() : '',
    relationship: typeof metadata.relationship === 'string' ? metadata.relationship.trim() : '',
    sport: isSport(metadata.sport) ? metadata.sport : null,
  };
}

export function isSupporterSetupComplete(
  profile: Pick<UserProfile, 'role' | 'displayName' | 'teamName' | 'athleteName' | 'seasonName'>,
) {
  return profile.role === 'fan'
    && Boolean(profile.displayName && profile.teamName && profile.athleteName && profile.seasonName);
}

type FanCardDestinationCandidate = {
  inviteToken: string;
  athleteName: string;
  teamName: string;
  paused: boolean;
};

export function getSupporterFanCard<T extends FanCardDestinationCandidate>(
  invites: readonly T[],
  profile: Pick<SupporterProfile, 'athleteName' | 'teamName'>,
) {
  const normalize = (value: string) => value.trim().toLowerCase();
  const athleteName = normalize(profile.athleteName);
  const teamName = normalize(profile.teamName);
  const matchingInvite = athleteName
    ? invites.find((invite) => normalize(invite.athleteName) === athleteName
      && (!teamName || normalize(invite.teamName) === teamName))
    : undefined;
  return matchingInvite;
}

export function getSupporterFanCardReconnectionCandidates<T extends FanCardDestinationCandidate>(
  invites: readonly T[],
  profile: Pick<SupporterProfile, 'athleteName' | 'teamName'>,
) {
  return getShowcaseInviteReconnectionCandidates(invites, profile);
}

export function getSupporterFanCardToSyncAfterProfileChange<T extends FanCardDestinationCandidate>(
  invites: readonly T[],
  previousProfile: Pick<SupporterProfile, 'athleteName' | 'teamName'>,
  nextProfile: Pick<SupporterProfile, 'athleteName' | 'teamName'>,
) {
  const normalize = (value: string) => value.trim().toLowerCase();
  if (!normalize(previousProfile.athleteName)
    || !normalize(previousProfile.teamName)
    || !normalize(nextProfile.athleteName)
    || !normalize(nextProfile.teamName)) return undefined;
  const identityChanged = normalize(previousProfile.athleteName) !== normalize(nextProfile.athleteName)
    || normalize(previousProfile.teamName) !== normalize(nextProfile.teamName);
  if (!identityChanged || getSupporterFanCard(invites, nextProfile)) return undefined;
  return getSupporterFanCard(invites, previousProfile);
}

export function getSupporterFanCardHref(
  invites: readonly FanCardDestinationCandidate[],
  profile: Pick<SupporterProfile, 'athleteName' | 'teamName'>,
) {
  const invite = getSupporterFanCard(invites, profile);

  return invite && !invite.paused
    ? `/fan/${encodeURIComponent(invite.inviteToken)}`
    : '/studio/athlete-page';
}

export function supporterProfileFromUser(user: UserLike): SupporterProfile {
  const profile = getUserProfile(user);
  return {
    displayName: profile.displayName,
    teamName: profile.teamName,
    seasonName: profile.seasonName,
    athleteName: profile.athleteName,
    jerseyNumber: profile.jerseyNumber,
    position: profile.position,
    relationship: profile.relationship,
    accessMode: profile.accessMode,
    sport: profile.sport,
  };
}

export type ProfileSeededHypeCard = {
  playerName: string;
  jerseyNumber: string;
  position: string;
  teamName: string;
};
export function cleanSupporterProfile(
  profile: SupporterProfile,
): Omit<SupporterProfile, 'accessMode' | 'seasonName'> & { seasonName: string } {
  return {
    displayName: profile.displayName.trim(),
    teamName: profile.teamName.trim(),
    seasonName: profile.seasonName?.trim() ?? '',
    athleteName: profile.athleteName.trim(),
    jerseyNumber: profile.jerseyNumber.trim().replace(/^#/, '').trim(),
    position: profile.position.trim(),
    relationship: profile.relationship.trim(),
    sport: profile.sport,
  };
}

export function getStudioDestination(_role: UserRole | null): 'supporter' {
  return 'supporter';
}

export function createSupporterProfileSavePlan(
  existingMetadata: unknown,
  profile: SupporterProfile,
): {
  unsafeMetadata: Record<string, unknown>;
  redirectTo: '/studio';
    studioDestination: ReturnType<typeof getStudioDestination>;
} {
  const currentMetadata = typeof existingMetadata === 'object' && existingMetadata !== null
    ? existingMetadata as Record<string, unknown>
    : {};
  const unsafeMetadata = {
    ...currentMetadata,
    ...cleanSupporterProfile(profile),
  };

  return {
    unsafeMetadata,
    redirectTo: '/studio',
    studioDestination: getStudioDestination('fan'),
  };
}

export type SupporterScheduleSource = 'custom' | null;

export type SupporterGameStage = 'upcoming' | 'live' | 'completed';

export const supporterToolRoutes = {
  schedule: '/studio/schedule',
  statTracker: '/studio/stat-tracker',
  checklist: '/studio/checklist',
  athletePage: '/studio/athlete-page',
  profile: '/studio/profile',
} as const;
export type SupporterGameLike = {
  id: string;
  date: string;
  time: string;
  timezone?: string;
  status?: ScheduleEventStatus;
  completedAt?: string;
  type?: 'game' | 'practice' | 'meeting';
};

export type SupporterWeekEventLike = SupporterGameLike & {
  type: 'game' | 'practice' | 'meeting';
};

export type SupporterWeekRecommendation<T extends SupporterWeekEventLike = SupporterWeekEventLike> = {
  event: T;
  kind: 'game' | 'practice' | 'meeting';
  stage: SupporterGameStage;
};

export type SupporterPreparationKind = SupporterWeekRecommendation['kind'];

const RECENT_COMPLETED_GAME_WINDOW_MS = 24 * 60 * 60 * 1000;

export function getSupporterPreparationCopy(kind: SupporterPreparationKind | null): {
  title: string;
  description: string;
} {
  switch (kind) {
    case 'game':
      return {
        title: 'Get ready for game day.',
        description: 'Game day is coming up. Check what you need before you leave.',
      };
    case 'practice':
      return {
        title: 'Get ready for practice.',
        description: 'Practice is coming up. Check what you need before you leave.',
      };
    case 'meeting':
      return {
        title: 'Get ready for your meeting.',
        description: 'Your meeting is coming up. Check what you need before you leave.',
      };
    default:
      return {
        title: 'Get ready for your next event.',
        description: 'Add an event to the schedule so Pixl can guide what you need next.',
      };
  }
}

export const supporterActiveGameStorageKey = 'pixlsports-supporter-active-game';
export const supporterStageAcknowledgmentStoragePrefix = 'pixlsports-supporter-stage-ack';

export type SupporterStorageSyncEvent =
  | { type: 'active-game'; gameId: string }
  | { type: 'stage-acknowledgment'; gameId: string; stage: SupporterGameStage; key: string }
  | { type: 'local-hype-card' }
  | null;

export function getSupporterStageAcknowledgmentKey(
  gameId: string,
  stage: SupporterGameStage,
): string {
  return `${supporterStageAcknowledgmentStoragePrefix}:${encodeURIComponent(gameId)}:${stage}`;
}

export function parseSupporterStorageSyncEvent(event: {
  key: string | null;
  newValue: string | null;
}): SupporterStorageSyncEvent {
  if (event.key === hypeCardProjectStorageKey) {
    return { type: 'local-hype-card' };
  }

  if (event.key === supporterActiveGameStorageKey) {
    const gameId = event.newValue?.trim();
    return gameId ? { type: 'active-game', gameId } : null;
  }

  if (!event.key || event.newValue !== '1') return null;

  const keyPrefix = `${supporterStageAcknowledgmentStoragePrefix}:`;
  if (!event.key.startsWith(keyPrefix)) return null;

  const match = /^([^:]+):(upcoming|live|completed)$/.exec(event.key.slice(keyPrefix.length));
  if (!match) return null;

  try {
    const gameId = decodeURIComponent(match[1]);
    if (!gameId.trim()) return null;
    const stage = match[2] as SupporterGameStage;
    return {
      type: 'stage-acknowledgment',
      gameId,
      stage,
      key: event.key,
    };
  } catch {
    return null;
  }
}

export function hasAcknowledgedSupporterGameStage(
  storage: Pick<Storage, 'getItem'>,
  gameId: string,
  stage: SupporterGameStage,
): boolean {
  try {
    return storage.getItem(getSupporterStageAcknowledgmentKey(gameId, stage)) === '1';
  } catch {
    return false;
  }
}

export function acknowledgeSupporterGameStage(
  storage: Pick<Storage, 'setItem'>,
  gameId: string,
  stage: SupporterGameStage,
): void {
  try {
    storage.setItem(getSupporterStageAcknowledgmentKey(gameId, stage), '1');
  } catch {
    // The reminder remains available for this session when storage is unavailable.
  }
}

function parseSupporterEventTime(value: string): { hour: number; minute: number } | null {
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return {
      hour: (hour % 12) + (twelveHour[3].toUpperCase() === 'PM' ? 12 : 0),
      minute,
    };
  }

  const twentyFourHour = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!twentyFourHour) return null;
  const hour = Number(twentyFourHour[1]);
  const minute = Number(twentyFourHour[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function getSupporterGameStage(
  game: Pick<SupporterGameLike, 'date' | 'time' | 'status' | 'type' | 'timezone'>,
  now = new Date(),
  options: { includePregameCaptureWindow?: boolean } = {},
): SupporterGameStage {
  if (game.status === 'final') return 'completed';

  const todayKey = getSupporterEventLocalDateKey(now, game.timezone)
    ?? [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
  const eventDateKey = normalizeSupporterEventDateKey(game.date)
    ?? game.date;
  // A saved status must not keep a previous day's event in the upcoming queue.
  if (eventDateKey < todayKey) return 'completed';
  if (game.status === 'live') return 'live';
  if (eventDateKey > todayKey) return 'upcoming';

  const eventTime = parseSupporterEventTime(game.time);
  const isGame = game.type === 'game' || !game.type;
  if (!eventTime) return isGame && options.includePregameCaptureWindow !== false ? 'live' : 'upcoming';
  const start = getSupporterEventStart(game.date, eventTime, game.timezone);
  if (!start) return 'upcoming';
  const captureStart = isGame && options.includePregameCaptureWindow !== false
    ? start.getTime() - 60 * 60 * 1000
    : start.getTime();
  if (captureStart > now.getTime()) return 'upcoming';
  return now.getTime() - start.getTime() <= 3 * 60 * 60 * 1000 ? 'live' : 'completed';
}

export function isSupporterGameInPregameCaptureWindow(
  game: Pick<SupporterGameLike, 'date' | 'time' | 'status' | 'type' | 'timezone'>,
  now = new Date(),
): boolean {
  if ((game.type !== undefined && game.type !== 'game') || game.status === 'live' || game.status === 'final') {
    return false;
  }
  if (!parseSupporterEventTime(game.time)) return false;
  return getSupporterGameStage(game, now) === 'live'
    && getSupporterGameStage(game, now, { includePregameCaptureWindow: false }) === 'upcoming';
}

export function getVisibleSupporterSelection<T extends SupporterGameLike>(
  events: readonly T[],
  selectedGameId: string | null,
  now = new Date(),
  selectedThisSession = false,
): T | undefined {
  const selected = selectedGameId
    ? events.find((event) => event.id === selectedGameId)
    : undefined;
  return selected && (selectedThisSession || getSupporterGameStage(selected, now) !== 'completed')
    ? selected
    : undefined;
}

export function getActiveSupporterGame<T extends SupporterGameLike>(
  games: readonly T[],
  selectedGameId: string | null,
  now = new Date(),
  selectedThisSession = false,
): T | undefined {
  const selected = getVisibleSupporterSelection(games, selectedGameId, now, selectedThisSession);
  if (selected) return selected;
  return games.find((game) => getSupporterGameStage(game, now) !== 'completed')
    ?? [...games].sort((left, right) => (
      right.date.localeCompare(left.date) || right.time.localeCompare(left.time)
    ))[0];
}

export function getNextUpcomingSupporterEvent<T extends SupporterWeekEventLike>(
  events: readonly T[],
  now = new Date(),
): T | undefined {
  return events
    .filter((event) => getSupporterGameStage(event, now) === 'upcoming')
    .sort((left, right) => (
      left.date.localeCompare(right.date)
      || left.time.localeCompare(right.time)
    ))[0];
}

export function getSupporterWeekRecommendation<T extends SupporterWeekEventLike>(
  events: readonly T[],
  now = new Date(),
  _completedMeetingIds: readonly string[] = [],
): SupporterWeekRecommendation<T> | null {
  const activeJourneyEvents = events.filter((event) => event.type !== 'meeting');
  const games = activeJourneyEvents.filter((event) => event.type === 'game');
  const liveGame = games.find((game) => getSupporterGameStage(game, now) === 'live');

  if (liveGame) {
    return {
      event: liveGame,
      kind: 'game',
      stage: 'live',
    };
  }

  const upcomingEvent = getNextUpcomingSupporterEvent(activeJourneyEvents, now);

  const recentCompletedGame = games
    .filter((game) => game.status === 'final' && typeof game.completedAt === 'string')
    .filter((game) => {
      const completedAt = Date.parse(game.completedAt!);
      return Number.isFinite(completedAt)
        && completedAt <= now.getTime()
        && now.getTime() - completedAt <= RECENT_COMPLETED_GAME_WINDOW_MS;
    })
    .sort((left, right) => Date.parse(right.completedAt!) - Date.parse(left.completedAt!))[0];

  if (recentCompletedGame) {
    return {
      event: recentCompletedGame,
      kind: 'game',
      stage: 'completed',
    };
  }

  if (upcomingEvent) {
    return {
      event: upcomingEvent,
      kind: upcomingEvent.type,
      stage: 'upcoming',
    };
  }

  const completedGame = [...games].sort((left, right) => (
    right.date.localeCompare(left.date) || right.time.localeCompare(left.time)
  ))[0];
  return completedGame
    ? {
      event: completedGame,
      kind: 'game',
      stage: 'completed',
    }
    : null;
}

export function getSupporterPreparationContext<T extends SupporterWeekEventLike>(
  recommendation: SupporterWeekRecommendation<T> | null,
  games: readonly T[],
  selectedGameId: string | null,
  selectedThisSession = false,
  now = new Date(),
): T | undefined {
  if (recommendation?.kind !== 'practice') return undefined;
  const selectedGame = games.find((game) => game.id === selectedGameId);
  // A stored selection for a completed game should not override the next practice.
  // An explicit selection made on this screen can still show an earlier game's details.
  if (selectedGame && (selectedThisSession || getSupporterGameStage(selectedGame, now) !== 'completed')) {
    return undefined;
  }
  return recommendation.event;
}

export function getSupporterDashboardContextEvent<T extends SupporterWeekEventLike>(
  preparationEvent: T | undefined,
  nextScheduledGame: T | undefined,
  nextEventCardGame: T | undefined,
  now = new Date(),
): T | undefined {
  if (preparationEvent) return preparationEvent;
  if (nextScheduledGame && getSupporterGameStage(nextScheduledGame, now) !== 'completed') {
    return nextScheduledGame;
  }
  return nextEventCardGame ?? nextScheduledGame;
}

export function readSupporterActiveGame(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(supporterActiveGameStorageKey);
  } catch {
    return null;
  }
}

export function saveSupporterActiveGame(
  storage: Pick<Storage, 'setItem'>,
  gameId: string,
) {
  storage.setItem(supporterActiveGameStorageKey, gameId);
}

export function getSupporterScheduleSelection<T>(input: {
  customSchedule?: { events: T[] } | null;
}): {
  events: T[];
  source: SupporterScheduleSource;
} {
  if (input.customSchedule && input.customSchedule.events.length > 0) {
    return {
      events: input.customSchedule.events,
      source: 'custom',
    };
  }

  return {
    events: [],
    source: null,
  };
}

export function seedHypeCardFromSupporterProfile<T extends ProfileSeededHypeCard>(
  project: T,
  profile: Pick<SupporterProfile, 'athleteName' | 'jerseyNumber' | 'position' | 'teamName'>,
): T {
  return {
    ...project,
    playerName: profile.athleteName || project.playerName,
    jerseyNumber: profile.jerseyNumber || project.jerseyNumber,
    position: profile.position || project.position,
    teamName: profile.teamName || project.teamName,
  };
}
