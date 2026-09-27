import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  accountAccessTable,
  db,
  plannerCardNotificationDeliveriesTable,
  plannerNotificationPreferencesTable,
  scheduleSharesTable,
  statTrackerSharesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendPushNotificationToUser } from "../lib/webPush";
import { GAME_ON_CARD_MARKER } from "../routes/scheduleShares";

const ONE_HOUR_MS = 60 * 60 * 1000;
const MORNING_HOUR = 7;
const CAPTURE_OPEN_GRACE_MS = 3 * ONE_HOUR_MS;
const PENDING_DELIVERY_TIMEOUT_MS = 2 * 60 * 1000;
const PENDING_DELIVERY_HEARTBEAT_MS = 20 * 1000;
const MAX_CONCURRENT_REMINDERS = 8;

type PlannerEvent = {
  id: string;
  type: "game" | "practice";
  status?: "upcoming" | "live" | "final";
  date: string;
  time: string;
  location: string;
  opponent: string;
};

type ReminderCard = {
  teamName: string;
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
    && (event.type === "game" || event.type === "practice")
    && isValidEventDate(asString(event.date));
}

function parseGameOnCard(events: unknown, teamName: string): ReminderCard | null {
  if (!Array.isArray(events) || events.length !== 1 || !isPlannerEvent(events[0])) return null;
  const event = events[0];
  return {
    teamName,
    events: [{
      id: event.id,
      type: event.type,
      ...(event.status ? { status: event.status } : {}),
      date: event.date,
      time: asString(event.time),
      location: asString(event.location),
      opponent: asString(event.opponent),
    }],
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

function reminderPayload(
  event: PlannerEvent,
  reminderType: PlannerReminderType,
) {
  const eventTypeLabel = event.type === "game" ? "GAME DAY" : "PRACTICE";
  return {
    title: reminderType === "one_hour"
      ? `${eventTypeLabel} · IN 1 HOUR`
      : reminderType === "capture_open"
        ? `${eventTypeLabel} · CAPTURE OPEN`
        : `${eventTypeLabel} · TODAY`,
    // Push notifications can outlive a browser sign-out on a shared device.
    // Keep private card details behind the authenticated app, not in the OS tray.
    body: reminderType === "day_of"
      ? "You have a Game On Card today. Sign in to see the details."
      : "Open Pixl Sports to see your Game On Card.",
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

async function sendGameOnCardReminder(
  shareId: string,
  ownerClerkUserId: string,
  card: ReminderCard,
  event: PlannerEvent,
  reminderType: PlannerReminderType,
  sendPush: typeof sendPushNotificationToUser,
  heartbeatMs: number,
  reminderNow: Date,
  beforeEligibilityRecheck?: (shareId: string) => Promise<void>,
) {
  const deliveryKey = and(
    eq(plannerCardNotificationDeliveriesTable.shareId, shareId),
    eq(plannerCardNotificationDeliveriesTable.eventId, event.id),
    eq(plannerCardNotificationDeliveriesTable.notificationType, reminderType),
    eq(plannerCardNotificationDeliveriesTable.eventDate, event.date),
  );
  const deliveryId = randomUUID();
  const now = new Date();
  const [inserted] = await db.insert(plannerCardNotificationDeliveriesTable).values({
    id: deliveryId,
    shareId,
    eventId: event.id,
    notificationType: reminderType,
    eventDate: event.date,
    createdAt: now,
  }).onConflictDoNothing().returning({ id: plannerCardNotificationDeliveriesTable.id });
  if (!inserted) {
    const [existing] = await db.select({
      id: plannerCardNotificationDeliveriesTable.id,
      sentAt: plannerCardNotificationDeliveriesTable.sentAt,
      displayedAt: plannerCardNotificationDeliveriesTable.displayedAt,
    }).from(plannerCardNotificationDeliveriesTable).where(deliveryKey).limit(1);
    if (!existing) return false;
    if (existing.sentAt) return true;
    if (existing.displayedAt) {
      // The service worker may have acknowledged display before a prior worker
      // exited without recording sentAt. Do not re-send that alert.
      await db.update(plannerCardNotificationDeliveriesTable)
        .set({ sentAt: existing.displayedAt })
        .where(and(
          eq(plannerCardNotificationDeliveriesTable.id, existing.id),
          isNull(plannerCardNotificationDeliveriesTable.sentAt),
        ));
      return true;
    }
    const [reclaimed] = await db.update(plannerCardNotificationDeliveriesTable)
      .set({ id: deliveryId, createdAt: now })
      .where(and(
        deliveryKey,
        eq(plannerCardNotificationDeliveriesTable.id, existing.id),
        isNull(plannerCardNotificationDeliveriesTable.sentAt),
        lt(plannerCardNotificationDeliveriesTable.createdAt, new Date(now.getTime() - PENDING_DELIVERY_TIMEOUT_MS)),
      ))
      .returning({ id: plannerCardNotificationDeliveriesTable.id });
    if (!reclaimed) return true;
  }

  await beforeEligibilityRecheck?.(shareId);
  // A card can be edited or removed while this run is selecting candidates.
  // Re-read the current event before contacting a push service.
  const [currentShare] = await db.select({
    ownerClerkUserId: scheduleSharesTable.ownerClerkUserId,
    title: scheduleSharesTable.title,
    events: scheduleSharesTable.events,
  }).from(scheduleSharesTable).where(and(
    eq(scheduleSharesTable.id, shareId),
    eq(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
  )).limit(1);
  const currentCard = currentShare && parseGameOnCard(currentShare.events, currentShare.title);
  const currentEvent = currentCard?.events[0];
  if (currentShare?.ownerClerkUserId !== ownerClerkUserId
    || currentCard?.teamName !== card.teamName
    || currentEvent?.id !== event.id
    || currentEvent?.date !== event.date
    || currentEvent?.time !== event.time
    || currentEvent?.status !== event.status
    || currentEvent?.type !== event.type) {
    await db.delete(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.id, deliveryId));
    return false;
  }

  const [[latestSubscription], [latestPreferences], [account], trackerShares] = await Promise.all([
    db.select({ timezone: webPushSubscriptionsTable.timezone })
      .from(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId))
      .orderBy(desc(webPushSubscriptionsTable.updatedAt)).limit(1),
    db.select({ oneHourBefore: plannerNotificationPreferencesTable.oneHourBefore, dayOf: plannerNotificationPreferencesTable.dayOf })
      .from(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerClerkUserId)).limit(1),
    db.select({ lifecycleStatus: accountAccessTable.lifecycleStatus, pauseEndsAt: accountAccessTable.pauseEndsAt })
      .from(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId)).limit(1),
    event.type === "game"
      ? db.select({ game: statTrackerSharesTable.game }).from(statTrackerSharesTable)
        .where(and(eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId), eq(statTrackerSharesTable.gameId, event.id))).limit(1)
      : Promise.resolve([] as Array<{ game: unknown }>),
  ]);
  const accountInactive = account && account.lifecycleStatus !== "active"
    && !(account.lifecycleStatus === "paused" && account.pauseEndsAt && account.pauseEndsAt <= reminderNow);
  if (!latestSubscription
    || accountInactive
    || trackerShares.some((share) => (share.game as { status?: unknown })?.status === "final")
    || !getReminderTypes(
      event.date, event.time, reminderNow, latestSubscription.timezone || "UTC",
      latestPreferences ?? DEFAULT_REMINDER_PREFERENCES,
    ).includes(reminderType)) {
    await db.delete(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.id, deliveryId));
    return false;
  }

  const heartbeat = setInterval(() => {
    void db.update(plannerCardNotificationDeliveriesTable)
      .set({ createdAt: new Date() })
      .where(and(
        eq(plannerCardNotificationDeliveriesTable.id, deliveryId),
        isNull(plannerCardNotificationDeliveriesTable.sentAt),
      ))
      .catch((error) => logger.warn({ err: error }, "Unable to renew pending Game On reminder"));
  }, heartbeatMs);
  heartbeat.unref();
  let result: Awaited<ReturnType<typeof sendPush>>;
  try {
    result = await sendPush(ownerClerkUserId, {
      ...reminderPayload(event, reminderType),
      deliveryId,
      tag: `planner-card-${shareId}-${event.id}-${reminderType}-${event.date}`,
    });
  } catch (error) {
    await db.delete(plannerCardNotificationDeliveriesTable).where(eq(plannerCardNotificationDeliveriesTable.id, deliveryId));
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
  if (result.sent === 0) {
    await db.delete(plannerCardNotificationDeliveriesTable).where(eq(plannerCardNotificationDeliveriesTable.id, deliveryId));
    return false;
  }
  await db.update(plannerCardNotificationDeliveriesTable)
    .set({ sentAt: new Date() })
    .where(eq(plannerCardNotificationDeliveriesTable.id, deliveryId));
  return true;
}

export type PlannerNotificationJobDependencies = {
  sendPushNotificationToUser?: typeof sendPushNotificationToUser;
  pendingDeliveryHeartbeatMs?: number;
  beforeEligibilityRecheck?: (shareId: string) => Promise<void>;
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

  const cards = await db
    .select({
      id: scheduleSharesTable.id,
      ownerClerkUserId: scheduleSharesTable.ownerClerkUserId,
      title: scheduleSharesTable.title,
      events: scheduleSharesTable.events,
    })
    .from(scheduleSharesTable)
    .where(eq(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER))
    .orderBy(desc(scheduleSharesTable.updatedAt), desc(scheduleSharesTable.id));
  const [accountRows, trackerRows] = await Promise.all([
    db.select({
      ownerClerkUserId: accountAccessTable.ownerClerkUserId,
      lifecycleStatus: accountAccessTable.lifecycleStatus,
      pauseEndsAt: accountAccessTable.pauseEndsAt,
    }).from(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, [...owners.keys()])),
    db.select({
      ownerClerkUserId: statTrackerSharesTable.ownerClerkUserId,
      gameId: statTrackerSharesTable.gameId,
      game: statTrackerSharesTable.game,
    }).from(statTrackerSharesTable).where(inArray(statTrackerSharesTable.ownerClerkUserId, [...owners.keys()])),
  ]);
  const inactiveOwners = new Set(accountRows
    .filter((row) => row.lifecycleStatus !== "active"
      && !(row.lifecycleStatus === "paused" && row.pauseEndsAt && row.pauseEndsAt <= now))
    .map((row) => row.ownerClerkUserId));
  const finalTrackedGames = new Set(trackerRows
    .filter((row) => (row.game as { status?: unknown })?.status === "final")
    .map((row) => `${row.ownerClerkUserId}\0${row.gameId}`));
  const cardEvents = new Set<string>();
  const dueReminders: Array<() => Promise<boolean>> = [];
  for (const row of cards) {
    const timezone = owners.get(row.ownerClerkUserId);
    if (!timezone || inactiveOwners.has(row.ownerClerkUserId)) continue;
    const card = parseGameOnCard(row.events, row.title);
    if (!card) continue;
    const event = card.events[0];
    const key = `${row.ownerClerkUserId}\0${event.id}\0${event.date}`;
    if (cardEvents.has(key)) continue;
    // The newest card is authoritative if duplicate shares reference one event.
    cardEvents.add(key);
    if (event.status === "final"
      || (event.type === "game" && finalTrackedGames.has(`${row.ownerClerkUserId}\0${event.id}`))) continue;
    const preferences = preferencesByOwner.get(row.ownerClerkUserId) ?? DEFAULT_REMINDER_PREFERENCES;
    for (const reminderType of getReminderTypes(event.date, event.time, now, timezone, preferences)) {
      dueReminders.push(() => sendGameOnCardReminder(
        row.id, row.ownerClerkUserId, card, event, reminderType, sendPush,
        dependencies.pendingDeliveryHeartbeatMs ?? PENDING_DELIVERY_HEARTBEAT_MS, now,
        dependencies.beforeEligibilityRecheck,
      ));
    }
  }
  let nextReminder = 0;
  const errors: unknown[] = [];
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_REMINDERS, dueReminders.length) },
    async () => {
      while (nextReminder < dueReminders.length) {
        const send = dueReminders[nextReminder++]!;
        try {
          await send();
        } catch (error) {
          errors.push(error);
          logger.error({ err: error }, "Unable to process Game On reminder");
        }
      }
    },
  ));
  if (errors.length > 0) {
    throw new AggregateError(errors, `${errors.length} Game On reminders failed`);
  }
}
