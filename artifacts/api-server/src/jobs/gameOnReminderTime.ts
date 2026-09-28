import { isIanaTimezone } from "../lib/timezone";

export type QueuedReminderType = "one_hour" | "day_of" | "capture_open";
export type TimedGameOnEvent = {
  id: string;
  type: "game" | "practice";
  date: string;
  time: string;
  timezone?: string;
  status?: string;
};
export type ReminderTimes = { type: QueuedReminderType; dueAt: Date; expiresAt: Date };

const HOUR = 60 * 60 * 1000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function eventTime(value: string) {
  const twelve = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = Number(twelve[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return { hour: hour % 12 + (twelve[3]!.toUpperCase() === "PM" ? 12 : 0), minute };
  }
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!twentyFour) return null;
  const hour = Number(twentyFour[1]);
  const minute = Number(twentyFour[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function formatter(timezone: string) {
  let cached = formatterCache.get(timezone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatterCache.set(timezone, cached);
  }
  return cached;
}

function localParts(date: Date, timezone: string) {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(date)
    .map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour,
    minute: parts.minute, second: parts.second };
}

export function localInstant(date: string, time: string, timezone: string): Date | null {
  if (!isIanaTimezone(timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return null;
  const clock = eventTime(time);
  if (!clock) return null;
  const [year, month, day] = date.split("-").map(Number);
  const wallUtc = Date.UTC(year, month! - 1, day, clock.hour, clock.minute);
  const candidates = new Set<number>();
  for (const sample of [wallUtc - 24 * HOUR, wallUtc, wallUtc + 24 * HOUR]) {
    const parts = localParts(new Date(sample), timezone);
    const offset = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!)
      - sample;
    candidates.add(wallUtc - offset);
  }
  const matches = [...candidates].sort((a, b) => a - b).filter((candidate) => {
    const parts = localParts(new Date(candidate), timezone);
    return parts.year === year && parts.month === month && parts.day === day
      && parts.hour === clock.hour && parts.minute === clock.minute;
  });
  // A skipped DST clock time is not a real event instant. For a repeated
  // clock time choose the first occurrence consistently.
  return matches.length ? new Date(matches[0]) : null;
}

export function scheduledGameOnTimes(
  event: TimedGameOnEvent,
  timezone: string,
  preferences: { oneHourBefore: boolean; dayOf: boolean },
): ReminderTimes[] {
  const start = localInstant(event.date, event.time, timezone);
  const result: ReminderTimes[] = [];
  if (preferences.dayOf) {
    const morning = localInstant(event.date, "07:00", timezone);
    if (morning && (!start || morning < start)) {
      const following = new Date(`${event.date}T00:00:00.000Z`);
      following.setUTCDate(following.getUTCDate() + 1);
      const nextDay = localInstant(following.toISOString().slice(0, 10), "00:00", timezone);
      result.push({ type: "day_of", dueAt: morning, expiresAt: start ?? nextDay ?? new Date(morning.getTime() + 17 * HOUR) });
    }
  }
  if (start && preferences.oneHourBefore) {
    result.push({ type: "one_hour", dueAt: new Date(start.getTime() - HOUR), expiresAt: start });
    result.push({ type: "capture_open", dueAt: start, expiresAt: new Date(start.getTime() + 3 * HOUR) });
  }
  return result;
}