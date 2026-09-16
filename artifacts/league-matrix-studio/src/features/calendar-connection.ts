const subscriptionPathPattern = /^\/api\/coach-calendar\/feed\/([A-Za-z0-9_-]{32,100})(?:\.ics)?\/?$/;

export function getCoachCalendarSubscriptionToken(
  value: string,
  origin: string,
  currentHostname: string,
) {
  try {
    const url = new URL(value.trim(), origin);
    if (!['http:', 'https:', 'webcal:'].includes(url.protocol)) return null;
    const allowedHosts = new Set([
      currentHostname.toLowerCase(),
      'pixlsports.com',
      'www.pixlsports.com',
    ]);
    if (!allowedHosts.has(url.hostname.toLowerCase())) return null;
    return url.pathname.match(subscriptionPathPattern)?.[1] ?? null;
  } catch {
    return null;
  }
}