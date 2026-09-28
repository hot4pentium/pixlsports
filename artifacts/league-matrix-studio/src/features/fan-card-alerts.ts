export type FanAlertChoice = 'live' | 'event';

export function nextFanAlertPreferences(
  current: { liveAlerts: boolean; preEventAlerts: boolean },
  choice: FanAlertChoice,
) {
  return {
    liveAlerts: choice === 'live' ? !current.liveAlerts : current.liveAlerts,
    preEventAlerts: choice === 'event' ? !current.preEventAlerts : current.preEventAlerts,
  };
}