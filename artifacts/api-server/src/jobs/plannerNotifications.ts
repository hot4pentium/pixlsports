import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  cloudProjectsTable,
  db,
  plannerNotificationDeliveriesTable,
  plannerNotificationPreferencesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendPushNotificationToUser } from "../lib/webPush";

const INTERVAL_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const MORNING_HOUR = 7;
const CAPTURE_OPEN_GRACE_MS = 3 * ONE_HOUR_MS;

type PlannerEvent = {
  id: string;
  type: "game" | "practice" | "meeting";
  status?: "upcoming" | "live" | "final";
  date: string;
  time: string;
  location: string;
  opponent: string;
};

type PlannerProject = {
  teamName: string;
  season: string;
  events: PlannerEvent[];
};

export type PlannerReminderType = "one_hour" | "day_of" | "capture_open";

export type PlannerReminderPreferences = {
  oneHourBefore: boolean;
  dayOf: boolean;
};

const DEFAULT_REMINDER_PREFERENCES: PlannerReminderPreferences = {
  oneHourBefore: true,
  dayOf: false,
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isValidEventDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPlannerEvent(value: unknown): value is PlannerEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<PlannerEvent>;
  return typeof event.id === "string"
    && (event.type === "game" || event.type === "practice" || event.type === "meeting")
    && isValidEventDate(asString(event.date));
}

function parsePlannerProject(value: unknown): PlannerProject | null {
  if (!value || typeof value !== "object") return null;
  const project = value as { tool?: unknown; teamName?: unknown; season?: unknown; events?: unknown };
  if (project.tool !== "schedule" || !Array.isArray(project.events)) return null;
  return {
    teamName: asString(project.teamName),
    season: asString(project.season),
    events: project.events.filter(isPlannerEvent).map((event) => ({
      id: event.id,
      type: event.type,
      ...(event.status ? { status: event.status } : {}),
      date: event.date,
      time: asString(event.time),
      location: asString(event.location),
      opponent: asString(event.opponent),
    })),
  };
}

function getLocalDateTime(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      hour: Number(values.hour),
    };
  } catch {
    return getLocalDateTime(now, "UTC");
  }
}

function parseEventTime(value: string) {
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return {
      hour: (hour % 12) + (twelveHour[3].toUpperCase() === "PM" ? 12 : 0),
      minute,
    };
  }

  const twentyFourHour = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!twentyFourHour) return null;
  const hour = Number(twentyFourHour[1]);
  const minute = Number(twentyFourHour[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function getTimeZoneOffsetMs(date: Date, timezone: string) {
  try {
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
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    ) - date.getTime();
  } catch {
    return 0;
  }
}

function getEventStart(eventDate: string, eventTime: string, timezone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  const time = parseEventTime(eventTime);
  if (!dateMatch || !time) return null;

  const wallClockAsUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    time.hour,
    time.minute,
  );
  const firstGuess = wallClockAsUtc - getTimeZoneOffsetMs(new Date(wallClockAsUtc), timezone);
  const corrected = wallClockAsUtc - getTimeZoneOffsetMs(new Date(firstGuess), timezone);
  return new Date(corrected);
}

function getReminderTypes(
  eventDate: string,
  eventTime: string,
  now: Date,
  timezone: string,
  preferences: PlannerReminderPreferences = DEFAULT_REMINDER_PREFERENCES,
): PlannerReminderType[] {
  const reminders: PlannerReminderType[] = [];
  const local = getLocalDateTime(now, timezone);
  const eventStart = getEventStart(eventDate, eventTime, timezone);
  const nowMs = now.getTime();
  const eventStartMs = eventStart?.getTime() ?? Number.POSITIVE_INFINITY;

  if (
    preferences.dayOf
    && local.date === eventDate
    && local.hour >= MORNING_HOUR
    && nowMs < eventStartMs
  ) {
    reminders.push("day_of");
  }

  if (
    preferences.oneHourBefore
    && eventStart
    && nowMs >= eventStartMs - ONE_HOUR_MS
    && nowMs < eventStartMs
  ) {
    reminders.push("one_hour");
  } else if (
    preferences.oneHourBefore
    && eventStart
    && nowMs >= eventStartMs
    && nowMs < eventStartMs + CAPTURE_OPEN_GRACE_MS
  ) {
    reminders.push("capture_open");
  }

  return reminders;
}

function eventLabel(event: PlannerEvent) {
  if (event.type === "game") return event.opponent ? `Game vs ${event.opponent}` : "Game day";
  if (event.type === "practice") return "Practice";
  return "Team meeting";
}

function eventDetails(event: PlannerEvent) {
  const details = [
    event.time ? `at ${event.time}` : "",
    event.location ? `at ${event.location}` : "",
  ].filter(Boolean);
  return details.length > 0 ? ` ${details.join(" ")}` : "";
}

function reminderPayload(
  project: PlannerProject,
  event: PlannerEvent,
  reminderType: PlannerReminderType,
) {
  const label = eventLabel(event);
  return {
    title: reminderType === "one_hour"
      ? `Starting in 1 hour: ${label}`
      : reminderType === "capture_open"
        ? `Capture window open: ${label}`
        : `Today: ${label}`,
    body: reminderType === "day_of"
      ? `${project.teamName || "Your team"}${eventDetails(event)}. Open Pixl Sports to see the full week.`
      : `${project.teamName || "Your team"}${eventDetails(event)}. Open Pixl Sports to capture the moment.`,
    url: "/studio",
  };
}

export function getPlannerReminderTypesForTest(
  eventDate: string,
  eventTime: string,
  now: Date,
  timezone: string,
  preferences: PlannerReminderPreferences = DEFAULT_REMINDER_PREFERENCES,
) {
  return getReminderTypes(eventDate, eventTime, now, timezone, preferences);
}

async function sendPlannerReminder(
  projectId: string,
  ownerClerkUserId: string,
  project: PlannerProject,
  event: PlannerEvent,
  reminderType: PlannerReminderType,
  sendPush: typeof sendPushNotificationToUser,
) {
  const [existingDelivery] = await db
    .select({ id: plannerNotificationDeliveriesTable.id })
    .from(plannerNotificationDeliveriesTable)
    .where(and(
      eq(plannerNotificationDeliveriesTable.projectId, projectId),
      eq(plannerNotificationDeliveriesTable.eventId, event.id),
      eq(plannerNotificationDeliveriesTable.notificationType, reminderType),
      eq(plannerNotificationDeliveriesTable.eventDate, event.date),
    ))
    .limit(1);
  if (existingDelivery) return;
  const deliveryId = randomUUID();

  const result = await sendPush(ownerClerkUserId, {
    ...reminderPayload(project, event, reminderType),
    deliveryId,
    tag: `planner-${projectId}-${event.id}-${reminderType}-${event.date}`,
  });
  if (result.sent === 0) return;

  await db.insert(plannerNotificationDeliveriesTable).values({
    id: deliveryId,
    projectId,
    eventId: event.id,
    notificationType: reminderType,
    eventDate: event.date,
  }).onConflictDoNothing();
}

export type PlannerNotificationJobDependencies = {
  sendPushNotificationToUser?: typeof sendPushNotificationToUser;
};

export async function runPlannerNotificationJob(
  now = new Date(),
  dependencies: PlannerNotificationJobDependencies = {},
) {
  const sendPush = dependencies.sendPushNotificationToUser ?? sendPushNotificationToUser;
  const subscriptions = await db
    .select({
      ownerClerkUserId: webPushSubscriptionsTable.ownerClerkUserId,
      timezone: webPushSubscriptionsTable.timezone,
    })
    .from(webPushSubscriptionsTable)
    .orderBy(desc(webPushSubscriptionsTable.updatedAt));
  const owners = new Map<string, string>();
  for (const subscription of subscriptions) {
    if (!owners.has(subscription.ownerClerkUserId)) {
      owners.set(subscription.ownerClerkUserId, subscription.timezone || "UTC");
    }
  }
  if (owners.size === 0) return;

  const preferenceRows = await db
    .select({
      ownerClerkUserId: plannerNotificationPreferencesTable.ownerClerkUserId,
      oneHourBefore: plannerNotificationPreferencesTable.oneHourBefore,
      dayOf: plannerNotificationPreferencesTable.dayOf,
    })
    .from(plannerNotificationPreferencesTable);
  const preferencesByOwner = new Map(
    preferenceRows.map((row) => [row.ownerClerkUserId, {
      oneHourBefore: row.oneHourBefore,
      dayOf: row.dayOf,
    }]),
  );

  const projects = await db
    .select({
      id: cloudProjectsTable.id,
      ownerClerkUserId: cloudProjectsTable.ownerClerkUserId,
      project: cloudProjectsTable.project,
    })
    .from(cloudProjectsTable);

  for (const row of projects) {
    const timezone = owners.get(row.ownerClerkUserId);
    if (!timezone) continue;
    const project = parsePlannerProject(row.project);
    if (!project) continue;
    const preferences = preferencesByOwner.get(row.ownerClerkUserId) ?? DEFAULT_REMINDER_PREFERENCES;
    for (const event of project.events) {
      if (event.type === "game" && event.status === "final") continue;
      const reminderTypes = getReminderTypes(event.date, event.time, now, timezone, preferences);
      for (const reminderType of reminderTypes) {
        await sendPlannerReminder(row.id, row.ownerClerkUserId, project, event, reminderType, sendPush);
      }
    }
  }
}

export function startPlannerNotificationSchedule() {
  const run = () => {
    void runPlannerNotificationJob().catch((error) => {
      logger.error({ err: error }, "Planner notification job failed");
    });
  };
  const initial = setTimeout(run, 15_000);
  const interval = setInterval(run, INTERVAL_MS);
  initial.unref();
  interval.unref();
}