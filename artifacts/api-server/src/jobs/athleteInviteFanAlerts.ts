import { and, eq } from "drizzle-orm";
import { athleteInvitesTable, cloudProjectsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { notifyAthleteInviteFans } from "../lib/athleteInviteFanNotifications";
import { isAccountActive } from "../lib/accountLifecycle";
import { isIanaTimezone } from "../lib/timezone";

const INTERVAL_MS = 60 * 1000;
const EVENT_START_GRACE_MS = 3 * 60 * 1000;

function parseEventTime(value: unknown) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(input);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return { hour: (hour % 12) + (twelveHour[3].toUpperCase() === "PM" ? 12 : 0), minute };
  }
  const twentyFourHour = /^(\d{1,2}):(\d{2})$/.exec(input);
  if (!twentyFourHour) return null;
  const hour = Number(twentyFourHour[1]);
  const minute = Number(twentyFourHour[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  ) - date.getTime();
}

export function getAthleteInviteEventStartForTest(
  date: unknown,
  time: unknown,
  timezone: unknown,
) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date) return null;
  const parsedTime = parseEventTime(time);
  if (!parsedTime) return null;
  if (!isIanaTimezone(timezone)) return null;
  const zone = timezone;
  try {
    const wallClockUtc = Date.UTC(
      dateValue.getUTCFullYear(),
      dateValue.getUTCMonth(),
      dateValue.getUTCDate(),
      parsedTime.hour,
      parsedTime.minute,
    );
    const first = wallClockUtc - timezoneOffsetMs(new Date(wallClockUtc), zone);
    return new Date(wallClockUtc - timezoneOffsetMs(new Date(first), zone));
  } catch {
    return null;
  }
}

export async function runAthleteInviteFanAlertJob(now = new Date()) {
  const invites = await db.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.paused, false),
    eq(athleteInvitesTable.showSchedule, true),
  ));
  for (const invite of invites) {
    if (!(await isAccountActive(invite.ownerClerkUserId))
      || !invite.scheduleProjectId || !isIanaTimezone(invite.timezone)) continue;
    const [projectRow] = await db.select({
      ownerClerkUserId: cloudProjectsTable.ownerClerkUserId,
      project: cloudProjectsTable.project,
    }).from(cloudProjectsTable).where(and(
      eq(cloudProjectsTable.id, invite.scheduleProjectId),
      eq(cloudProjectsTable.ownerClerkUserId, invite.ownerClerkUserId),
    )).limit(1);
    if (!projectRow?.project || typeof projectRow.project !== "object" || Array.isArray(projectRow.project)) continue;
    const project = projectRow.project as { tool?: unknown; events?: unknown };
    if (project.tool !== "schedule" || !Array.isArray(project.events)) continue;
    for (const rawEvent of project.events) {
      if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) continue;
      const event = rawEvent as Record<string, unknown>;
      if (event.status === "final") continue;
      const start = getAthleteInviteEventStartForTest(event.date, event.time, invite.timezone);
      if (!start || now.getTime() < start.getTime() || now.getTime() >= start.getTime() + EVENT_START_GRACE_MS) continue;
      const eventId = typeof event.id === "string" && event.id.length <= 120 ? event.id : "schedule-event";
      const eventKey = `${eventId}:${start.toISOString()}`;
      await notifyAthleteInviteFans(invite.id, eventKey, "event");
    }
  }
}

export function startAthleteInviteFanAlertSchedule() {
  const run = () => void runAthleteInviteFanAlertJob().catch((error) => {
    logger.error({ err: error }, "Athlete invite fan alert job failed");
  });
  const initial = setTimeout(run, 15_000);
  const interval = setInterval(run, INTERVAL_MS);
  initial.unref();
  interval.unref();
}