export type ScheduleInstallAction = 'installed' | 'install' | 'instructions';

export function isIosDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function getScheduleInstallAction({
  isStandalone,
  canPrompt,
}: {
  isStandalone: boolean;
  canPrompt: boolean;
}): ScheduleInstallAction {
  if (isStandalone) return 'installed';
  return canPrompt ? 'install' : 'instructions';
}