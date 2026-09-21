import { and, eq } from "drizzle-orm";
import {
  cloudProjectsTable,
  db,
  plannerNotificationDeliveriesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendPushNotificationToUser } from "../lib/webPush";

const INTERVAL_MS = 15 * 60 * 1000;
const MORNING_HOUR = 7;
const EVENING_HOUR = 18;

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

export type PlannerReminderType = "today" | "tomorrow";

type LocalDateTime = {
  date: string;
  hour: number;
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

function getLocalDateTime(now: Date, timezone: string): LocalDateTime {
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

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function getReminderType(
  eventDate: string,
  local: LocalDateTime,
): PlannerReminderType | null {
  if (local.date === eventDate && local.hour >= MORNING_HOUR) return "today";
  if (local.date === addDays(eventDate, -1) && local.hour >= EVENING_HOUR) return "tomorrow";
  return null;
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
    title: reminderType === "today" ? `Today: ${label}` : `Tomorrow: ${label}`,
    body: `${project.teamName || "Your team"}${eventDetails(event)}. Open Pixl Sports to see the full week.`,
    url: "/studio",
  };
}

export function getPlannerReminderForTest(
  eventDate: string,
  now: Date,
  timezone: string,
) {
  return getReminderType(eventDate, getLocalDateTime(now, timezone));
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

  const result = await sendPush(ownerClerkUserId, {
    ...reminderPayload(project, event, reminderType),
    tag: `planner-${projectId}-${event.id}-${reminderType}-${event.date}`,
  });
  if (result.sent === 0) return;

  await db.insert(plannerNotificationDeliveriesTable).values({
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
    .from(webPushSubscriptionsTable);
  const owners = new Map<string, string>();
  for (const subscription of subscriptions) {
    if (!owners.has(subscription.ownerClerkUserId)) {
      owners.set(subscription.ownerClerkUserId, subscription.timezone || "UTC");
    }
  }
  if (owners.size === 0) return;

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
    const local = getLocalDateTime(now, timezone);
    for (const event of project.events) {
      if (event.type === "game" && event.status === "final") continue;
      const reminderType = getReminderType(event.date, local);
      if (!reminderType) continue;
      await sendPlannerReminder(row.id, row.ownerClerkUserId, project, event, reminderType, sendPush);
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