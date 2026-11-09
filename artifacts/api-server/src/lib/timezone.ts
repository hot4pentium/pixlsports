export function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** Resolve an event's wall time independently of the server/viewer's time zone.
 * Repeated DST times use the earlier instant; skipped times advance by the gap.
 */
export function scheduledEventStart(date: string, time: string, timezone: string): Date | null {
  if (!isIanaTimezone(timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const wall = day.getTime() + (hour * 60 + minute) * 60_000;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const localStamp = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
  };
  const offsets = new Set([-36, 0, 36].map((hours) => {
    const sample = wall + hours * 3_600_000;
    return localStamp(sample) - sample;
  }));
  const candidates = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
  const exact = candidates.find((instant) => localStamp(instant) === wall);
  if (exact !== undefined) return new Date(exact);
  const forward = candidates.filter((instant) => localStamp(instant) > wall)
    .sort((a, b) => localStamp(a) - localStamp(b) || a - b)[0];
  return forward === undefined ? null : new Date(forward);
}