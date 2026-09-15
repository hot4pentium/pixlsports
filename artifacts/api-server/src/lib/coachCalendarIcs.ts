import { createHash } from "node:crypto";

type CalendarEvent = {
  id: string;
  type: "game" | "practice" | "meeting";
  date: string;
  time: string;
  location: string;
  opponent: string;
  snacks: string;
  drinks: string;
  notes: string;
};

type CalendarSchedule = {
  title: string;
  teamSeason: string;
  events: CalendarEvent[];
  updatedAt: Date | null;
};

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string) {
  const folded: string[] = [];
  let chunk = "";
  let limit = 75;

  for (const character of Array.from(line)) {
    if (Buffer.byteLength(chunk + character, "utf8") > limit && chunk) {
      folded.push(folded.length === 0 ? chunk : ` ${chunk}`);
      chunk = character;
      limit = 74;
    } else {
      chunk += character;
    }
  }

  folded.push(folded.length === 0 ? chunk : ` ${chunk}`);
  return folded.join("\r\n");
}

function validDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function validTimeParts(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function basicDate(parts: { year: number; month: number; day: number }) {
  return `${String(parts.year).padStart(4, "0")}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function basicDateTime(
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
) {
  return `${basicDate(date)}T${String(time.hour).padStart(2, "0")}${String(time.minute).padStart(2, "0")}00`;
}

function addMinutes(
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
  minutes: number,
) {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute + minutes));
  return {
    date: {
      year: result.getUTCFullYear(),
      month: result.getUTCMonth() + 1,
      day: result.getUTCDate(),
    },
    time: {
      hour: result.getUTCHours(),
      minute: result.getUTCMinutes(),
    },
  };
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function utcTimestamp(value: Date | null) {
  const date = value && !Number.isNaN(value.getTime()) ? value : new Date(0);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function eventSummary(event: CalendarEvent) {
  if (event.type === "practice") return "Team practice";
  if (event.type === "meeting") return "Team meeting";
  return event.opponent.trim() ? `Game vs ${event.opponent.trim()}` : "Team game";
}

function eventDescription(schedule: CalendarSchedule, event: CalendarEvent) {
  return [
    schedule.title.trim() ? `Team: ${schedule.title.trim()}` : "",
    schedule.teamSeason.trim() ? `Season: ${schedule.teamSeason.trim()}` : "",
    event.snacks.trim() ? `Snacks: ${event.snacks.trim()}` : "",
    event.drinks.trim() ? `Drinks: ${event.drinks.trim()}` : "",
    event.notes.trim(),
  ].filter(Boolean).join("\n");
}

function stableEventUid(ownerClerkUserId: string, eventId: string, occurrence: number) {
  const digest = createHash("sha256")
    .update(`${ownerClerkUserId}\0${eventId}\0${occurrence}`)
    .digest("hex")
    .slice(0, 32);
  return `${digest}@calendar.pixlsports`;
}

export function buildCoachCalendarIcs(
  ownerClerkUserId: string,
  schedule: CalendarSchedule | null,
) {
  const title = schedule?.title.trim() || "Pixl Sports Schedule";
  const season = schedule?.teamSeason.trim() || "";
  const calendarName = season ? `${title} — ${season}` : title;
  const updatedAt = utcTimestamp(schedule?.updatedAt ?? null);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pixl Sports//Team Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-PUBLISHED-TTL:PT15M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];
  const occurrences = new Map<string, number>();

  for (const event of schedule?.events ?? []) {
    const date = validDateParts(event.date);
    if (!date) continue;

    const occurrence = (occurrences.get(event.id) ?? 0) + 1;
    occurrences.set(event.id, occurrence);
    const time = validTimeParts(event.time);
    const description = eventDescription(schedule!, event);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${stableEventUid(ownerClerkUserId, event.id, occurrence)}`);
    lines.push(`DTSTAMP:${updatedAt}`);
    lines.push(`LAST-MODIFIED:${updatedAt}`);
    if (time) {
      const end = addMinutes(date, time, 60);
      lines.push(`DTSTART:${basicDateTime(date, time)}`);
      lines.push(`DTEND:${basicDateTime(end.date, end.time)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${basicDate(date)}`);
      lines.push(`DTEND;VALUE=DATE:${basicDate(addDays(date, 1))}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(eventSummary(event))}`);
    if (event.location.trim()) lines.push(`LOCATION:${escapeIcsText(event.location.trim())}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}