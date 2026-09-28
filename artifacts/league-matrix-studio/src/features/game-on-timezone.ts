const fallbackTimeZones = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'America/Anchorage',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Kolkata',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Brisbane',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Rome',
  'Pacific/Auckland',
  'UTC',
];

const intlWithTimeZoneList = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};
const supportedTimeZones = intlWithTimeZoneList.supportedValuesOf?.('timeZone') ?? fallbackTimeZones;
const baseTimeZoneOptions = [...new Set(['UTC', ...fallbackTimeZones, ...supportedTimeZones])]
  .filter(isIanaTimeZone)
  .sort((left, right) => left.localeCompare(right));

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function getBrowserTimeZone(): string {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return browserTimeZone && isIanaTimeZone(browserTimeZone) ? browserTimeZone : 'UTC';
}

export function resolveGameOnTimeZone(timeZone?: string): string {
  return timeZone && isIanaTimeZone(timeZone) ? timeZone : getBrowserTimeZone();
}

export function getGameOnTimeZoneOptions(currentTimeZone?: string): string[] {
  if (!currentTimeZone || baseTimeZoneOptions.includes(currentTimeZone) || !isIanaTimeZone(currentTimeZone)) {
    return baseTimeZoneOptions;
  }
  return [...baseTimeZoneOptions, currentTimeZone].sort((left, right) => left.localeCompare(right));
}