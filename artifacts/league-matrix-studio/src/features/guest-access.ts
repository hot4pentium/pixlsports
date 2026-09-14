export type GuestUsageCategory = 'hype_card' | 'schedule_event' | 'lineup';

export function getGuestUsageKey(category: GuestUsageCategory, scope = 'editor', persist = true) {
  const storageKey = `leaguematrix-guest-usage-key:${category}:${scope}`;
  if (!persist) {
    return typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const key = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(storageKey, key);
    return key;
  } catch {
    return `${category}:${scope}:${Date.now()}`;
  }
}