import type { SupporterProfile, SupporterProject } from './supporter-dashboard';
import { isSport, type Sport } from './stat-tracker';
import type { ScheduleEventStatus } from './schedule-draft';

export type UserRole = 'coach' | 'fan';
export type AccessMode = 'full' | 'guest';

export interface UserProfile {
  role: UserRole | null;
  displayName: string;
  teamName: string;
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
  return role === 'coach' || role === 'fan' ? role : null;
}

export function getUserProfile(user: UserLike): UserProfile {
  const metadata = typeof user?.unsafeMetadata === 'object' && user.unsafeMetadata !== null
    ? user.unsafeMetadata as Record<string, unknown>
    : {};
  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  const role = metadata.role === 'coach' || metadata.role === 'fan' ? metadata.role : null;

  return {
    role,
    displayName: typeof metadata.displayName === 'string' && metadata.displayName.trim()
      ? metadata.displayName.trim()
      : clerkName,
    teamName: typeof metadata.teamName === 'string' ? metadata.teamName.trim() : '',
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

export function supporterProfileFromUser(user: UserLike): SupporterProfile {
  const profile = getUserProfile(user);
  return {
    displayName: profile.displayName,
    teamName: profile.teamName,
    athleteName: profile.athleteName,
    jerseyNumber: profile.jerseyNumber,
    position: profile.position,
    relationship: profile.relationship,
    accessMode: profile.accessMode,
    sport: profile.sport,
  };
}

export function cleanSupporterProfile(profile: SupporterProfile): Omit<SupporterProfile, 'accessMode'> {
  return {
    displayName: profile.displayName.trim(),
    teamName: profile.teamName.trim(),
    athleteName: profile.athleteName.trim(),
    jerseyNumber: profile.jerseyNumber.trim().replace(/^#/, '').trim(),
    position: profile.position.trim(),
    relationship: profile.relationship.trim(),
    sport: profile.sport,
  };
}

export function getStudioDestination(role: UserRole | null): 'role-selection' | 'supporter' | 'coach' {
  if (!role) return 'role-selection';
  return role === 'fan' ? 'supporter' : 'coach';
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
    studioDestination: getStudioDestination(getUserRole({ unsafeMetadata })),
  };
}

export type CalendarViewState = 'loading' | 'invalid' | 'failed' | 'disconnected' | 'empty' | 'connected' | 'custom';

export type SupporterScheduleSource = 'team' | 'custom' | null;

export type SupporterGameStage = 'upcoming' | 'live' | 'completed';

export const supporterToolRoutes = {
  hypeCard: '/studio/hype-card',
  schedule: '/studio/schedule',
  statTracker: '/studio/stat-tracker',
  checklist: '/studio/checklist',
} as const;
export type SupporterGameLike = {
  id: string;
  date: string;
  time: string;
  status?: ScheduleEventStatus;
};

export const supporterActiveGameStorageKey = 'pixlsports-supporter-active-game';
export const supporterStageAcknowledgmentStoragePrefix = 'pixlsports-supporter-stage-ack';

export function getSupporterStageAcknowledgmentKey(
  gameId: string,
  stage: SupporterGameStage,
): string {
  return `${supporterStageAcknowledgmentStoragePrefix}:${encodeURIComponent(gameId)}:${stage}`;
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

export function getSupporterGameStage(
  game: Pick<SupporterGameLike, 'date' | 'time' | 'status'>,
  now = new Date(),
): SupporterGameStage {
  if (game.status === 'upcoming') return 'upcoming';
  if (game.status === 'live') return 'live';
  if (game.status === 'final') return 'completed';

  const todayKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  if (game.date > todayKey) return 'upcoming';
  if (game.date < todayKey) return 'completed';

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(game.time.trim());
  if (!timeMatch) return 'live';
  const start = new Date(now);
  start.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  if (start.getTime() > now.getTime()) return 'upcoming';
  return now.getTime() - start.getTime() <= 3 * 60 * 60 * 1000 ? 'live' : 'completed';
}

export function getActiveSupporterGame<T extends SupporterGameLike>(
  games: readonly T[],
  selectedGameId: string | null,
  now = new Date(),
): T | undefined {
  const selected = selectedGameId
    ? games.find((game) => game.id === selectedGameId)
    : undefined;
  if (selected) return selected;
  return games.find((game) => getSupporterGameStage(game, now) !== 'completed')
    ?? games.at(-1);
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
  hasTeamConnection: boolean;
  teamSchedule: { events: T[] } | null | undefined;
  customSchedule?: { events: T[] } | null;
}): {
  events: T[];
  source: SupporterScheduleSource;
} {
  if (input.hasTeamConnection && input.teamSchedule) {
    return {
      events: input.teamSchedule.events,
      source: 'team',
    };
  }

  if (!input.hasTeamConnection && input.customSchedule && input.customSchedule.events.length > 0) {
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

export function getCalendarViewState(input: {
  calendarCode: string;
  loading: boolean;
  invalid: boolean;
  failed: boolean;
  calendar: { events: unknown[] } | null | undefined;
  customSchedule?: { events: unknown[] } | null;
}): CalendarViewState {
  if (input.calendarCode && input.invalid) return 'invalid';
  if (input.calendarCode && input.loading) return 'loading';
  if (input.calendarCode && input.failed) return 'failed';
  if (!input.calendarCode || !input.calendar) {
    return input.customSchedule && input.customSchedule.events.length > 0 ? 'custom' : 'disconnected';
  }
  return input.calendar.events.length === 0 ? 'empty' : 'connected';
}

interface CloudProjectLike {
  id: string;
  name: string;
  updatedAt: string | Date;
  project: unknown;
}

export function mapRecentSupporterProjects(projects: CloudProjectLike[]): SupporterProject[] {
  return [...projects]
    .filter((project) => !(
      typeof project.project === 'object'
      && project.project !== null
      && (project.project as { tool?: unknown }).tool === 'schedule'
    ))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 4)
    .map((project) => ({
      id: project.id,
      name: project.name,
      kind: 'hype-card',
      updatedAt: project.updatedAt,
      href: `/studio/hype-card/${project.id}`,
      thumbnailProject: project.project,
    }));
}
