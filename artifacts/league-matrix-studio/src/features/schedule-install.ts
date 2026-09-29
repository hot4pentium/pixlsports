export type ScheduleInstallAction = 'installed' | 'install' | 'instructions';

export function isStandaloneInstallMode(
  displayModeStandalone: boolean,
  navigatorStandalone?: boolean,
): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}

export const IOS_SCHEDULE_INSTALL_INSTRUCTIONS =
  'On iPhone or iPad, tap Share, choose Add to Home Screen, then tap Add.';
export const BROWSER_SCHEDULE_INSTALL_INSTRUCTIONS =
  'Open your browser menu and choose Install Pixl Sports or Add to Home Screen. If neither option is available, bookmark this link for quick access.';

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

export function getScheduleInstallInstructions(isIOS: boolean): string {
  return isIOS
    ? IOS_SCHEDULE_INSTALL_INSTRUCTIONS
    : BROWSER_SCHEDULE_INSTALL_INSTRUCTIONS;
}