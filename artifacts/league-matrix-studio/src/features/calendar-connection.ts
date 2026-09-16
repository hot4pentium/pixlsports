const subscriptionTokenPattern = /^[A-Za-z0-9_-]{32,100}$/;
const subscriptionPathPattern = /^\/api\/coach-calendar\/feed\/([A-Za-z0-9_-]{32,100})(?:\.ics)?\/?$/;
const calendarHandoffPathPattern = /^\/studio\/schedule\/?$/;
const calendarHandoffQueryKeys = ['calendarToken', 'calendar'];

function isAllowedPixlSportsHost(hostname: string, currentHostname: string) {
  return new Set([
    currentHostname.toLowerCase(),
    'pixlsports.com',
    'www.pixlsports.com',
  ]).has(hostname.toLowerCase());
}

export function getCoachCalendarHandoffToken(value: string, origin: string, currentHostname: string) {
  try {
    const url = new URL(value.trim(), origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!isAllowedPixlSportsHost(url.hostname, currentHostname)) return null;
    if (!calendarHandoffPathPattern.test(url.pathname)) return null;

    for (const key of calendarHandoffQueryKeys) {
      const token = url.searchParams.get(key)?.trim() ?? '';
      if (subscriptionTokenPattern.test(token)) return token;
    }
    return null;
  } catch {
    return null;
  }
}

export function getCoachCalendarSubscriptionToken(
  value: string,
  origin: string,
  currentHostname: string,
) {
  try {
    const url = new URL(value.trim(), origin);
    if (!['http:', 'https:', 'webcal:'].includes(url.protocol)) return null;
    if (!isAllowedPixlSportsHost(url.hostname, currentHostname)) return null;
    return url.pathname.match(subscriptionPathPattern)?.[1] ?? null;
  } catch {
    return null;
  }
}