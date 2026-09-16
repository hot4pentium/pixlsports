import type { SupporterProfile, SupporterProject } from './supporter-dashboard';

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
}

type UserLike = {
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

export type CalendarViewState = 'loading' | 'failed' | 'disconnected' | 'empty' | 'connected';

export function getCalendarViewState(input: {
  calendarCode: string;
  loading: boolean;
  failed: boolean;
  calendar: { events: unknown[] } | null | undefined;
}): CalendarViewState {
  if (input.calendarCode && input.loading) return 'loading';
  if (input.calendarCode && input.failed) return 'failed';
  if (!input.calendarCode || !input.calendar) return 'disconnected';
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
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 4)
    .map((project) => {
      const kind = typeof project.project === 'object'
        && project.project !== null
        && (project.project as { tool?: unknown }).tool === 'schedule'
        ? 'schedule'
        : 'hype-card';
      return {
        id: project.id,
        name: project.name,
        kind,
        updatedAt: project.updatedAt,
        href: `/studio/${kind}/${project.id}`,
      };
    });
}