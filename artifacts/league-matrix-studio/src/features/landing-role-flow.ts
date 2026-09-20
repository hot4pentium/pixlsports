import type { UserRole } from './supporter-dashboard-model';

export type ToolKind = 'hype' | 'schedule' | 'roster' | 'stat-tracker' | 'checklist';

export const roleToolKinds: Record<UserRole, ToolKind[]> = {
  coach: ['schedule', 'roster', 'checklist'],
  fan: ['schedule', 'checklist', 'stat-tracker', 'hype'],
};

export function getRoleIntent(search: string): UserRole | null {
  const role = new URLSearchParams(search).get('role');
  return role === 'coach' || role === 'fan' ? role : null;
}

export function roleSignupHref(role: UserRole): string {
  return `/sign-up?role=${role}`;
}