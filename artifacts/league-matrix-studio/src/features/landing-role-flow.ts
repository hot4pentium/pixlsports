import type { UserRole } from './supporter-dashboard-model';

export type ToolKind = 'hype' | 'schedule' | 'stat-tracker' | 'checklist';

export const roleToolKinds: Record<UserRole, ToolKind[]> = {
  fan: ['schedule', 'checklist', 'stat-tracker', 'hype'],
};

export function roleSignupHref(_role: UserRole = 'fan'): string {
  return '/sign-up';
}