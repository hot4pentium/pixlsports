import { resolveGameOnTimeZone } from './game-on-timezone';

type SupporterZonedDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const supporterTimeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

function getSupporterZonedDateTime(date: Date, timezone: string): SupporterZonedDateTime | null {
  try {
    let formatter = supporterTimeZoneFormatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      supporterTimeZoneFormatters.set(timezone, formatter);
    }
    const parts = formatter.formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const result = {
      year: value('year'),
      month: value('month'),
      day: value('day'),
      hour: value('hour'),
      minute: value('minute'),
      second: value('second'),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

function parseSupporterEventDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year
    && check.getUTCMonth() === month - 1
    && check.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function formatSupporterDateKey(parts: Pick<SupporterZonedDateTime, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getSupporterWallTimestamp(parts: SupporterZonedDateTime): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function normalizeSupporterEventDateKey(value: string): string | null {
  const date = parseSupporterEventDate(value);
  return date ? formatSupporterDateKey(date) : null;
}

export function getSupporterEventLocalDateKey(date: Date, timezone?: string): string | null {
  const resolvedTimeZone = resolveGameOnTimeZone(timezone);
  const parts = getSupporterZonedDateTime(date, resolvedTimeZone);
  return parts ? formatSupporterDateKey(parts) : null;
}

export function getSupporterEventStart(
  date: string,
  eventTime: { hour: number; minute: number },
  timezone?: string,
): Date | null {
  const eventDate = parseSupporterEventDate(date);
  if (
    !eventDate
    || !Number.isInteger(eventTime.hour)
    || eventTime.hour < 0
    || eventTime.hour > 23
    || !Number.isInteger(eventTime.minute)
    || eventTime.minute < 0
    || eventTime.minute > 59
  ) return null;

  const resolvedTimeZone = resolveGameOnTimeZone(timezone);
  const targetWallTime = Date.UTC(
    eventDate.year,
    eventDate.month - 1,
    eventDate.day,
    eventTime.hour,
    eventTime.minute,
  );

  // Gather the offsets around this wall time so both sides of a clock change
  // are considered. This gives repeated times a deterministic earlier instant
  // and lets nonexistent times move forward by the size of the clock gap.
  const offsets = new Set<number>();
  const searchRadius = 36 * 60 * 60 * 1000;
  const searchStep = 6 * 60 * 60 * 1000;
  for (let delta = -searchRadius; delta <= searchRadius; delta += searchStep) {
    const timestamp = targetWallTime + delta;
    const zoned = getSupporterZonedDateTime(new Date(timestamp), resolvedTimeZone);
    if (!zoned) return null;
    offsets.add(getSupporterWallTimestamp(zoned) - timestamp);
  }

  const exactStarts: number[] = [];
  const forwardCandidates: Array<{ timestamp: number; wallDelta: number }> = [];
  for (const offset of offsets) {
    const timestamp = targetWallTime - offset;
    const zoned = getSupporterZonedDateTime(new Date(timestamp), resolvedTimeZone);
    if (!zoned) return null;
    const observedWallTime = getSupporterWallTimestamp(zoned);
    if (observedWallTime === targetWallTime) {
      exactStarts.push(timestamp);
    } else if (observedWallTime > targetWallTime) {
      forwardCandidates.push({ timestamp, wallDelta: observedWallTime - targetWallTime });
    }
  }

  if (exactStarts.length > 0) {
    return new Date(Math.min(...exactStarts));
  }

  // A wall time inside a spring-forward gap is interpreted using the offset
  // from before the jump, preserving its minutes while shifting it forward.
  forwardCandidates.sort((left, right) => left.wallDelta - right.wallDelta || left.timestamp - right.timestamp);
  return forwardCandidates.length > 0 ? new Date(forwardCandidates[0].timestamp) : null;
}