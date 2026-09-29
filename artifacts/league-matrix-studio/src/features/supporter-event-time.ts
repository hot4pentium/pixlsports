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
  if (!eventDate) return null;

  const resolvedTimeZone = resolveGameOnTimeZone(timezone);
  const targetWallTime = Date.UTC(
    eventDate.year,
    eventDate.month - 1,
    eventDate.day,
    eventTime.hour,
    eventTime.minute,
  );
  let timestamp = targetWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const zoned = getSupporterZonedDateTime(new Date(timestamp), resolvedTimeZone);
    if (!zoned) return null;
    const observedWallTime = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    const adjustment = targetWallTime - observedWallTime;
    if (adjustment === 0) return new Date(timestamp);
    timestamp += adjustment;
  }
  return new Date(timestamp);
}