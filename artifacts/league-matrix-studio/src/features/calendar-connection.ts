const subscriptionTokenPattern = /^[A-Za-z0-9_-]{32,100}$/;
const subscriptionPathPattern = /^\/api\/coach-calendar\/feed\/([A-Za-z0-9_-]{32,100})(?:\.ics)?\/?$/;
const calendarHandoffPathPattern = /^\/studio\/schedule\/?$/;
const calendarHandoffQueryKeys = ['calendarToken', 'calendar'];
const connectedCoachCodeStorageKey = 'leaguematrix-connected-coach-code';
const connectedCoachSubscriptionStorageKey = 'leaguematrix-connected-coach-subscription-token';

export type CalendarConnection =
  | { kind: 'code'; value: string }
  | { kind: 'subscription'; value: string };

export type CalendarConnectionErrorKind = 'invalid' | 'temporary';

export function getStoredCalendarConnection(
  storage: Storage = window.localStorage,
): CalendarConnection | null {
  const subscriptionToken = storage.getItem(connectedCoachSubscriptionStorageKey) ?? '';
  if (subscriptionTokenPattern.test(subscriptionToken)) {
    return { kind: 'subscription', value: subscriptionToken };
  }

  const code = storage.getItem(connectedCoachCodeStorageKey) ?? '';
  return code ? { kind: 'code', value: code } : null;
}

export function storeCalendarConnection(
  connection: CalendarConnection,
  storage: Storage = window.localStorage,
) {
  if (connection.kind === 'subscription') {
    storage.setItem(connectedCoachSubscriptionStorageKey, connection.value);
    storage.removeItem(connectedCoachCodeStorageKey);
  } else {
    storage.setItem(connectedCoachCodeStorageKey, connection.value);
    storage.removeItem(connectedCoachSubscriptionStorageKey);
  }
}

export function clearStoredCalendarConnection(storage: Storage = window.localStorage) {
  storage.removeItem(connectedCoachCodeStorageKey);
  storage.removeItem(connectedCoachSubscriptionStorageKey);
}

export function getCalendarConnectionErrorKind(error: unknown): CalendarConnectionErrorKind {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined;

  return status === 404 ? 'invalid' : 'temporary';
}

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