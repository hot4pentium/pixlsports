import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  accountAccessTable,
  db,
  gameOnReminderAttemptsTable,
  gameOnReminderSyncTable,
  gameOnScheduledRemindersTable,
  plannerNotificationPreferencesTable,
  plannerOwnerEventAlertClaimsTable,
  scheduleSharesTable,
  statTrackerSharesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { isIanaTimezone } from "../lib/timezone";
import {
  scheduledGameOnTimes,
  type QueuedReminderType,
  type TimedGameOnEvent,
} from "./gameOnReminderTime";
import { sendPushNotificationToSubscription, type PushNotificationPayload } from "../lib/webPush";

const GAME_ON_CARD_MARKER = "@pixlsports:game-on-card:v1";
const GLOBAL_SYNC_KEY = "game-on-reminders:global";
const RUNNER_STATE_KEY = "game-on-reminders:runner";
const MAX_REMINDERS_PER_RUN = 2;
const MAX_SUBSCRIPTIONS_PER_REMINDER = 2;
const SYNC_PAGE_SIZE = 5;
const MAX_TOTAL_ATTEMPTS = 12;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
const PUSH_TIMEOUT_MS = 8_000;
const STALE_INFLIGHT_MS = 30_000;
const OWNER_SYNC_BUDGET_MS = 8_000;
const DELIVERY_START_BUDGET_MS = 12_000;

type ReminderStatus = "pending" | "failed" | "sending" | "sent" | "uncertain" | "cancelled";
type AttemptStatus = "sending" | "sent" | "stale" | "temporary" | "permanent" | "uncertain";
type SubscriptionInput = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};
type SendResult = {
  configured: boolean;
  sent: boolean;
  stale: boolean;
  failure?: "temporary" | "permanent" | "uncertain";
};
type ReminderSender = (
  subscription: SubscriptionInput,
  payload: PushNotificationPayload,
  timeoutMs?: number,
) => Promise<SendResult>;
type ShareInput = {
  id: string;
  ownerClerkUserId: string;
  title: string;
  teamSeason: string;
  events: unknown;
};
type ReminderRow = typeof gameOnScheduledRemindersTable.$inferSelect;
type JobDependencies = {
  sendPushNotificationToSubscription?: ReminderSender;
  maxRemindersPerRun?: number;
  maxSubscriptionsPerReminder?: number;
  syncPageSize?: number;
};

const defaultSender = sendPushNotificationToSubscription as ReminderSender;

function validGameOnEvent(value: unknown): value is TimedGameOnEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<TimedGameOnEvent>;
  if (typeof event.id !== "string" || !event.id || (event.type !== "game" && event.type !== "practice")) return false;
  if (typeof event.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return false;
  const parsed = new Date(`${event.date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === event.date;
}

function getCardEvent(events: unknown) {
  if (!Array.isArray(events) || events.length !== 1 || !validGameOnEvent(events[0])) return null;
  const event = events[0]!;
  return {
    id: event.id,
    type: event.type,
    date: event.date,
    time: typeof event.time === "string" ? event.time : "",
    ...(typeof event.timezone === "string" ? { timezone: event.timezone } : {}),
    ...(typeof event.status === "string" ? { status: event.status } : {}),
  } satisfies TimedGameOnEvent;
}

async function isAuthoritativeShare(share: ShareInput, event: TimedGameOnEvent) {
  const [latest] = await db.select({ id: scheduleSharesTable.id })
    .from(scheduleSharesTable).where(and(
      eq(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
      eq(scheduleSharesTable.ownerClerkUserId, share.ownerClerkUserId),
      sql`${scheduleSharesTable.events}->0->>'id' = ${event.id}`,
      sql`${scheduleSharesTable.events}->0->>'date' = ${event.date}`,
    )).orderBy(desc(scheduleSharesTable.updatedAt), desc(scheduleSharesTable.id))
    .limit(1);
  return latest?.id === share.id;
}

function accountIsEligible(account: { lifecycleStatus: string; pauseEndsAt: Date | null } | undefined, now: Date) {
  return !account || account.lifecycleStatus === "active"
    || (account.lifecycleStatus === "paused" && account.pauseEndsAt !== null && account.pauseEndsAt <= now);
}

function payloadForReminder(row: ReminderRow, now: Date): PushNotificationPayload {
  const label = row.eventType === "game" ? "GAME DAY" : "PRACTICE";
  const lateOneHour = row.reminderType === "one_hour" && now.getTime() - row.dueAt.getTime() > 15 * 60_000;
  const type = row.reminderType as QueuedReminderType;
  return {
    title: type === "one_hour"
      ? `${label} · ${lateOneHour ? "COMING UP" : "IN 1 HOUR"}`
      : type === "capture_open" ? `${label} · CAPTURE OPEN` : `${label} · TODAY`,
    body: type === "day_of"
      ? "You have a Game On Card today. Sign in to see the details."
      : type === "one_hour"
        ? lateOneHour
          ? "Your event is coming up soon. Open Pixl Sports to publish or share your Hype Card."
          : "Your event is in one hour. Open Pixl Sports to publish or share your Hype Card."
        : "Open Pixl Sports to see your Game On Card.",
    url: "/studio",
    tag: `planner-card-${row.shareId}-${row.eventId}-${type}-${row.eventDate}`,
  };
}

function retryAt(now: Date, attemptCount: number) {
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delay);
}

function failureCategory(error: unknown): "uncertain" {
  // A thrown request can have reached the push service before the connection
  // failed. Treat it as uncertain instead of risking a duplicate notification.
  void error;
  return "uncertain";
}

async function getOwnerSettings(ownerClerkUserId: string) {
  const [[subscription], [preferences], [account]] = await Promise.all([
    db.select({
      id: webPushSubscriptionsTable.id,
      timezone: webPushSubscriptionsTable.timezone,
    })
      .from(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId))
      .orderBy(desc(webPushSubscriptionsTable.updatedAt))
      .limit(1),
    db.select({
      oneHourBefore: plannerNotificationPreferencesTable.oneHourBefore,
      dayOf: plannerNotificationPreferencesTable.dayOf,
    })
      .from(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerClerkUserId))
      .limit(1),
    db.select({
      lifecycleStatus: accountAccessTable.lifecycleStatus,
      pauseEndsAt: accountAccessTable.pauseEndsAt,
    })
      .from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
      .limit(1),
  ]);
  return { subscription, preferences, account };
}

async function cancelUndeliveredRows(shareId: string, keepKeys: string[]) {
  const rows = await db.select({
    id: gameOnScheduledRemindersTable.id,
    eventId: gameOnScheduledRemindersTable.eventId,
    eventDate: gameOnScheduledRemindersTable.eventDate,
    reminderType: gameOnScheduledRemindersTable.reminderType,
  }).from(gameOnScheduledRemindersTable).where(and(
    eq(gameOnScheduledRemindersTable.shareId, shareId),
    inArray(gameOnScheduledRemindersTable.status, ["pending", "failed"]),
  ));
  const keep = new Set(keepKeys);
  const staleIds = rows.filter((row) => !keep.has(`${row.eventId}\0${row.eventDate}\0${row.reminderType}`))
    .map((row) => row.id);
  if (staleIds.length) {
    await db.update(gameOnScheduledRemindersTable).set({
      status: "cancelled",
      claimToken: null,
      claimedAt: null,
      updatedAt: new Date(),
    }).where(and(
      inArray(gameOnScheduledRemindersTable.id, staleIds),
      inArray(gameOnScheduledRemindersTable.status, ["pending", "failed"]),
    ));
  }
}

/**
 * Upserts this card's upcoming reminders. Legacy cards without an event zone
 * use the owner's most recently refreshed subscription zone; an invalid zone
 * is not silently trusted and falls back to UTC.
 */
export async function reconcileGameOnShare(share: ShareInput, now = new Date()) {
  const candidate = share.teamSeason === GAME_ON_CARD_MARKER ? getCardEvent(share.events) : null;
  const event = candidate && await isAuthoritativeShare(share, candidate) ? candidate : null;
  const settings = await getOwnerSettings(share.ownerClerkUserId);
  const timezone = event?.timezone && isIanaTimezone(event.timezone)
    ? event.timezone
    : isIanaTimezone(settings.subscription?.timezone) ? settings.subscription!.timezone : "UTC";
  const preferences = settings.preferences ?? { oneHourBefore: false, dayOf: false };
  const eligible = Boolean(event
    && event.status !== "final"
    && settings.subscription
    && accountIsEligible(settings.account, now)
    && (preferences.oneHourBefore || preferences.dayOf));
  const times = eligible && event
    ? scheduledGameOnTimes(event, timezone, preferences)
    : [];
  const liveTimes = times.filter((time) => time.expiresAt > now);
  const keepKeys: string[] = [];

  for (const time of liveTimes) {
    const key = `${event!.id}\0${event!.date}\0${time.type}`;
    keepKeys.push(key);
    const row = {
      shareId: share.id,
      ownerClerkUserId: share.ownerClerkUserId,
      eventId: event!.id,
      eventDate: event!.date,
      eventTime: event!.time,
      eventType: event!.type,
      timezone,
      reminderType: time.type,
      dueAt: time.dueAt,
      expiresAt: time.expiresAt,
      status: "pending" as const,
      nextAttemptAt: time.dueAt,
      claimToken: null,
      claimedAt: null,
      eventClaimId: null,
      attemptCount: 0,
      lastFailure: null,
      sentAt: null,
    };
    const [existing] = await db.select({
      id: gameOnScheduledRemindersTable.id,
      status: gameOnScheduledRemindersTable.status,
      dueAt: gameOnScheduledRemindersTable.dueAt,
      expiresAt: gameOnScheduledRemindersTable.expiresAt,
      eventTime: gameOnScheduledRemindersTable.eventTime,
      timezone: gameOnScheduledRemindersTable.timezone,
      nextAttemptAt: gameOnScheduledRemindersTable.nextAttemptAt,
      attemptCount: gameOnScheduledRemindersTable.attemptCount,
    }).from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, share.id),
      eq(gameOnScheduledRemindersTable.eventId, event!.id),
      eq(gameOnScheduledRemindersTable.eventDate, event!.date),
      eq(gameOnScheduledRemindersTable.reminderType, time.type),
    )).limit(1);

    const scheduleChanged = existing && (
      existing.eventTime !== row.eventTime
      || existing.timezone !== row.timezone
      || existing.dueAt.getTime() !== row.dueAt.getTime()
      || existing.expiresAt.getTime() !== row.expiresAt.getTime()
    );
    let newDevice = false;
    if (existing?.status === "failed" && existing.nextAttemptAt >= existing.expiresAt
      && existing.attemptCount < MAX_TOTAL_ATTEMPTS) {
      const [untried] = await db.select({ id: webPushSubscriptionsTable.id })
        .from(webPushSubscriptionsTable).where(and(
          eq(webPushSubscriptionsTable.ownerClerkUserId, share.ownerClerkUserId),
          sql`not exists (
            select 1 from ${gameOnReminderAttemptsTable} attempts
            where attempts.reminder_id = ${existing.id}
              and attempts.subscription_id = ${webPushSubscriptionsTable.id}
          )`,
        )).limit(1);
      newDevice = Boolean(untried);
    }
    if (!existing) {
      await db.insert(gameOnScheduledRemindersTable).values(row).onConflictDoNothing();
    } else if (["pending", "failed", "cancelled"].includes(existing.status)
      && (existing.status === "cancelled"
        || scheduleChanged
        || newDevice)
      && existing.attemptCount < MAX_TOTAL_ATTEMPTS) {
      await db.update(gameOnScheduledRemindersTable).set({
        ownerClerkUserId: row.ownerClerkUserId,
        eventTime: row.eventTime,
        eventType: row.eventType,
        timezone: row.timezone,
        dueAt: row.dueAt,
        expiresAt: row.expiresAt,
        status: "pending",
        nextAttemptAt: row.nextAttemptAt,
        claimToken: null,
        claimedAt: null,
        updatedAt: now,
      }).where(and(
        eq(gameOnScheduledRemindersTable.id, existing.id),
        inArray(gameOnScheduledRemindersTable.status, ["pending", "failed", "cancelled"]),
      ));
    }
  }

  await cancelUndeliveredRows(share.id, keepKeys);
  return { queued: liveTimes.length, timezone };
}

export async function queueGameOnOwnerSync(ownerClerkUserId: string) {
  const key = `owner:${ownerClerkUserId}`;
  await db.insert(gameOnReminderSyncTable).values({ key, cursor: null })
    .onConflictDoUpdate({
      target: gameOnReminderSyncTable.key,
      set: { cursor: null, updatedAt: sql`${gameOnReminderSyncTable.updatedAt} + interval '1 millisecond'` },
    });
}

async function processSyncPage(
  key: string, ownerClerkUserId: string | null, pageSize: number, deadlineAt: number,
) {
  await db.insert(gameOnReminderSyncTable).values({ key, cursor: null }).onConflictDoNothing();
  const [state] = await db.select().from(gameOnReminderSyncTable)
    .where(eq(gameOnReminderSyncTable.key, key)).limit(1);
  if (!state) return 0;
  const where = and(
    eq(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
    ...(ownerClerkUserId ? [eq(scheduleSharesTable.ownerClerkUserId, ownerClerkUserId)] : []),
    ...(state.cursor ? [gt(scheduleSharesTable.id, state.cursor)] : []),
  );
  const shares = await db.select({
    id: scheduleSharesTable.id,
    ownerClerkUserId: scheduleSharesTable.ownerClerkUserId,
    title: scheduleSharesTable.title,
    teamSeason: scheduleSharesTable.teamSeason,
    events: scheduleSharesTable.events,
  }).from(scheduleSharesTable).where(where)
    .orderBy(asc(scheduleSharesTable.id)).limit(pageSize);
  const processed: typeof shares = [];
  for (const share of shares) {
    if (Date.now() >= deadlineAt) break;
    await reconcileGameOnShare(share);
    processed.push(share);
  }
  if (!processed.length && shares.length) return 0;

  const sameRequest = and(
    eq(gameOnReminderSyncTable.key, key),
    eq(gameOnReminderSyncTable.updatedAt, state.updatedAt),
  );
  if (ownerClerkUserId && processed.length === shares.length && shares.length < pageSize) {
    await db.delete(gameOnReminderSyncTable).where(sameRequest);
  } else {
    await db.update(gameOnReminderSyncTable).set({
      cursor: processed.at(-1)?.id ?? null,
      updatedAt: new Date(),
    }).where(sameRequest);
  }
  return processed.length;
}

async function claimDueReminders(now: Date, limit: number) {
  const expired = await db.select({ id: gameOnScheduledRemindersTable.id })
    .from(gameOnScheduledRemindersTable).where(and(
      inArray(gameOnScheduledRemindersTable.status, ["pending", "failed"]),
      lte(gameOnScheduledRemindersTable.expiresAt, now),
    )).limit(20);
  const expiredRows = expired.length ? await db.update(gameOnScheduledRemindersTable).set({
    status: "cancelled",
    claimToken: null,
    claimedAt: null,
    lastFailure: "expired",
    updatedAt: now,
  }).where(and(
    inArray(gameOnScheduledRemindersTable.id, expired.map((item) => item.id)),
    inArray(gameOnScheduledRemindersTable.status, ["pending", "failed"]),
    lte(gameOnScheduledRemindersTable.expiresAt, now),
  )).returning() : [];
  const abandonedClaims = await db.select().from(gameOnScheduledRemindersTable).where(and(
    eq(gameOnScheduledRemindersTable.status, "cancelled"),
    eq(gameOnScheduledRemindersTable.reminderType, "one_hour"),
    isNotNull(gameOnScheduledRemindersTable.eventClaimId),
    lte(gameOnScheduledRemindersTable.expiresAt, now),
  )).limit(20);
  const candidates = new Map([...expiredRows, ...abandonedClaims].map((row) => [row.id, row]));
  for (const row of candidates.values()) {
    if (row.reminderType !== "one_hour" || !row.eventClaimId) continue;
    const [possiblyDelivered] = await db.select({ id: gameOnReminderAttemptsTable.id })
      .from(gameOnReminderAttemptsTable).where(and(
        eq(gameOnReminderAttemptsTable.reminderId, row.id),
        inArray(gameOnReminderAttemptsTable.status, ["sent", "uncertain", "sending"]),
      )).limit(1);
    // Only known rejection/stale attempts may give way to capture-open.
    // A missing or uncertain delivery receipt must continue to block repeats.
    if (!possiblyDelivered) {
      await releaseOwnerEventClaim(row, row.eventClaimId);
      await db.update(gameOnScheduledRemindersTable).set({ eventClaimId: null })
        .where(and(
          eq(gameOnScheduledRemindersTable.id, row.id),
          eq(gameOnScheduledRemindersTable.status, "cancelled"),
          eq(gameOnScheduledRemindersTable.eventClaimId, row.eventClaimId),
        ));
    }
  }

  const staleBefore = new Date(now.getTime() - STALE_INFLIGHT_MS);
  const abandoned = await db.select({ id: gameOnScheduledRemindersTable.id })
    .from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.status, "sending"),
      lt(gameOnScheduledRemindersTable.claimedAt, staleBefore),
    )).limit(20);
  if (!abandoned.length) {
    return claimReadyReminders(now, limit);
  }
  const staleRows = await db.update(gameOnScheduledRemindersTable).set({
    status: "uncertain",
    claimToken: null,
    claimedAt: null,
    lastFailure: "claim_abandoned",
    updatedAt: now,
  }).where(and(
    inArray(gameOnScheduledRemindersTable.id, abandoned.map((item) => item.id)),
    eq(gameOnScheduledRemindersTable.status, "sending"),
    lt(gameOnScheduledRemindersTable.claimedAt, staleBefore),
  )).returning({ id: gameOnScheduledRemindersTable.id });
  if (staleRows.length) {
    await db.update(gameOnReminderAttemptsTable).set({
      status: "uncertain",
      failureCategory: "claim_abandoned",
      completedAt: now,
    }).where(and(
      inArray(gameOnReminderAttemptsTable.reminderId, staleRows.map((row) => row.id)),
      eq(gameOnReminderAttemptsTable.status, "sending"),
    ));
  }

  return claimReadyReminders(now, limit);
}

async function claimReadyReminders(now: Date, limit: number) {
  return db.transaction(async (tx) => {
    const candidates = await tx.select().from(gameOnScheduledRemindersTable).where(and(
      inArray(gameOnScheduledRemindersTable.status, ["pending", "failed"]),
      lt(gameOnScheduledRemindersTable.attemptCount, MAX_TOTAL_ATTEMPTS),
      lte(gameOnScheduledRemindersTable.dueAt, now),
      lte(gameOnScheduledRemindersTable.nextAttemptAt, now),
      gt(gameOnScheduledRemindersTable.expiresAt, now),
    )).orderBy(asc(gameOnScheduledRemindersTable.dueAt))
      .limit(limit).for("update", { skipLocked: true });
    const claimed: Array<{ row: ReminderRow; token: string }> = [];
    for (const row of candidates) {
      const token = randomUUID();
      const [updated] = await tx.update(gameOnScheduledRemindersTable).set({
        status: "sending",
        claimToken: token,
        claimedAt: now,
        attemptCount: row.attemptCount + 1,
        updatedAt: now,
      }).where(and(
        eq(gameOnScheduledRemindersTable.id, row.id),
        inArray(gameOnScheduledRemindersTable.status, ["pending", "failed"]),
      )).returning();
      if (updated) claimed.push({ row: updated, token });
    }
    return claimed;
  });
}

async function getLatestAttemptStatuses(reminderId: string) {
  const attempts = await db.select({
    subscriptionId: gameOnReminderAttemptsTable.subscriptionId,
    status: gameOnReminderAttemptsTable.status,
    startedAt: gameOnReminderAttemptsTable.startedAt,
  }).from(gameOnReminderAttemptsTable).where(eq(gameOnReminderAttemptsTable.reminderId, reminderId))
    .orderBy(desc(gameOnReminderAttemptsTable.startedAt));
  const latest = new Map<string, AttemptStatus>();
  for (const attempt of attempts) {
    if (!latest.has(attempt.subscriptionId)) latest.set(attempt.subscriptionId, attempt.status as AttemptStatus);
  }
  return latest;
}

async function recheckReminder(row: ReminderRow, now: Date) {
  const [share] = await db.select({
    id: scheduleSharesTable.id,
    ownerClerkUserId: scheduleSharesTable.ownerClerkUserId,
    title: scheduleSharesTable.title,
    events: scheduleSharesTable.events,
  }).from(scheduleSharesTable).where(and(
    eq(scheduleSharesTable.id, row.shareId),
    eq(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
  )).limit(1);
  const event = share && getCardEvent(share.events);
  if (!share || !event
    || share.ownerClerkUserId !== row.ownerClerkUserId
    || event.id !== row.eventId
    || event.date !== row.eventDate
    || event.time !== row.eventTime
    || event.type !== row.eventType
    || event.status === "final") return { eligible: false as const };
  if (!await isAuthoritativeShare({ ...share, teamSeason: GAME_ON_CARD_MARKER }, event)) {
    return { eligible: false as const };
  }

  const [settings, trackerRows] = await Promise.all([
    getOwnerSettings(row.ownerClerkUserId),
    row.eventType === "game"
      ? db.select({ game: statTrackerSharesTable.game }).from(statTrackerSharesTable).where(and(
        eq(statTrackerSharesTable.ownerClerkUserId, row.ownerClerkUserId),
        eq(statTrackerSharesTable.gameId, row.eventId),
      ))
      : Promise.resolve([] as Array<{ game: unknown }>),
  ]);
  const preferences = settings.preferences ?? { oneHourBefore: false, dayOf: false };
  if (!settings.subscription || !accountIsEligible(settings.account, now)
    || trackerRows.some((shareRow) => (shareRow.game as { status?: unknown })?.status === "final")) {
    return { eligible: false as const };
  }
  const timezone = event.timezone && isIanaTimezone(event.timezone)
    ? event.timezone
    : isIanaTimezone(settings.subscription.timezone) ? settings.subscription.timezone : "UTC";
  const enabled = row.reminderType === "day_of" ? preferences.dayOf : preferences.oneHourBefore;
  if (!enabled || timezone !== row.timezone) return { eligible: false as const };

  const time = scheduledGameOnTimes(event, timezone, preferences)
    .find((item) => item.type === row.reminderType);
  if (!time || time.dueAt.getTime() !== row.dueAt.getTime()
    || time.expiresAt.getTime() !== row.expiresAt.getTime()
    || now < time.dueAt || now >= time.expiresAt) {
    return { eligible: false as const };
  }
  return { eligible: true as const, event, settings, timezone };
}

async function claimOwnerEvent(row: ReminderRow, token: string, now: Date) {
  if (row.reminderType === "day_of") return { claimed: true, eventClaimId: null as string | null };
  if (row.eventClaimId) {
    const [claim] = await db.select({ id: plannerOwnerEventAlertClaimsTable.id })
      .from(plannerOwnerEventAlertClaimsTable).where(and(
        eq(plannerOwnerEventAlertClaimsTable.id, row.eventClaimId),
        eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, row.ownerClerkUserId),
        eq(plannerOwnerEventAlertClaimsTable.eventId, row.eventId),
        eq(plannerOwnerEventAlertClaimsTable.eventDate, row.eventDate),
      )).limit(1);
    if (claim) return { claimed: true, eventClaimId: claim.id };
  }

  const claimId = randomUUID();
  const [created] = await db.insert(plannerOwnerEventAlertClaimsTable).values({
    id: claimId,
    ownerClerkUserId: row.ownerClerkUserId,
    eventId: row.eventId,
    eventDate: row.eventDate,
    createdAt: now,
  }).onConflictDoNothing().returning({ id: plannerOwnerEventAlertClaimsTable.id });
  if (created) {
    await db.update(gameOnScheduledRemindersTable).set({ eventClaimId: created.id })
      .where(and(
        eq(gameOnScheduledRemindersTable.id, row.id),
        eq(gameOnScheduledRemindersTable.claimToken, token),
      ));
    return { claimed: true, eventClaimId: created.id };
  }

  const [existing] = await db.select({ id: plannerOwnerEventAlertClaimsTable.id })
    .from(plannerOwnerEventAlertClaimsTable).where(and(
      eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, row.ownerClerkUserId),
      eq(plannerOwnerEventAlertClaimsTable.eventId, row.eventId),
      eq(plannerOwnerEventAlertClaimsTable.eventDate, row.eventDate),
    )).limit(1);
  return { claimed: existing?.id === row.eventClaimId, eventClaimId: existing?.id ?? null };
}

async function releaseOwnerEventClaim(row: ReminderRow, eventClaimId: string | null) {
  if (!eventClaimId) return;
  await db.delete(plannerOwnerEventAlertClaimsTable).where(and(
    eq(plannerOwnerEventAlertClaimsTable.id, eventClaimId),
    eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, row.ownerClerkUserId),
    eq(plannerOwnerEventAlertClaimsTable.eventId, row.eventId),
    eq(plannerOwnerEventAlertClaimsTable.eventDate, row.eventDate),
  ));
}

async function attemptSubscription(
  row: ReminderRow,
  token: string,
  subscription: SubscriptionInput,
  send: ReminderSender,
  now: Date,
) {
  const [attempt] = await db.insert(gameOnReminderAttemptsTable).values({
    reminderId: row.id,
    subscriptionId: subscription.id,
    status: "sending",
    startedAt: now,
  }).returning({ id: gameOnReminderAttemptsTable.id });
  if (!attempt) return { status: "uncertain" as const, failureCategory: "attempt_not_recorded" };

  let status: AttemptStatus;
  let category: string | null = null;
  try {
    const result = await send(subscription, payloadForReminder(row, now), PUSH_TIMEOUT_MS);
    if (result.sent) status = "sent";
    else if (result.stale) status = "stale";
    else if (result.failure === "temporary" || !result.configured) {
      status = "temporary";
      category = result.configured ? "provider_temporary" : "push_not_configured";
    } else if (result.failure === "permanent") {
      status = "permanent";
      category = "provider_permanent";
    } else {
      status = "uncertain";
      category = "provider_outcome_uncertain";
    }
  } catch (error) {
    status = failureCategory(error);
    category = "provider_outcome_uncertain";
  }

  await db.update(gameOnReminderAttemptsTable).set({
    status,
    failureCategory: category,
    completedAt: new Date(),
  }).where(and(
    eq(gameOnReminderAttemptsTable.id, attempt.id),
    eq(gameOnReminderAttemptsTable.status, "sending"),
  ));
  if (status === "stale") {
    await db.delete(webPushSubscriptionsTable).where(and(
      eq(webPushSubscriptionsTable.id, subscription.id),
      eq(webPushSubscriptionsTable.ownerClerkUserId, row.ownerClerkUserId),
    ));
  }
  return { status, failureCategory: category };
}

async function deliverClaimedReminder(
  claimed: { row: ReminderRow; token: string },
  now: Date,
  send: ReminderSender,
  maxSubscriptions: number,
) {
  const row = claimed.row;
  const rechecked = await recheckReminder(row, now);
  if (!rechecked.eligible) {
    await db.update(gameOnScheduledRemindersTable).set({
      status: "cancelled",
      claimToken: null,
      claimedAt: null,
      lastFailure: "eligibility_changed",
      updatedAt: now,
    }).where(and(
      eq(gameOnScheduledRemindersTable.id, row.id),
      eq(gameOnScheduledRemindersTable.claimToken, claimed.token),
    ));
    return { sent: false, failed: false };
  }

  if (row.reminderType === "capture_open") {
    const [oneHour] = await db.select({ id: gameOnScheduledRemindersTable.id })
      .from(gameOnScheduledRemindersTable).where(and(
        eq(gameOnScheduledRemindersTable.ownerClerkUserId, row.ownerClerkUserId),
        eq(gameOnScheduledRemindersTable.eventId, row.eventId),
        eq(gameOnScheduledRemindersTable.eventDate, row.eventDate),
        eq(gameOnScheduledRemindersTable.reminderType, "one_hour"),
        inArray(gameOnScheduledRemindersTable.status, ["sending", "sent", "uncertain"]),
      )).limit(1);
    if (oneHour) {
      await db.update(gameOnScheduledRemindersTable).set({
        status: "cancelled", claimToken: null, claimedAt: null, lastFailure: "one_hour_claimed",
        updatedAt: now,
      }).where(and(
        eq(gameOnScheduledRemindersTable.id, row.id),
        eq(gameOnScheduledRemindersTable.claimToken, claimed.token),
      ));
      return { sent: false, failed: false };
    }
  }

  const eventClaim = await claimOwnerEvent(row, claimed.token, now);
  if (!eventClaim.claimed) {
    await db.update(gameOnScheduledRemindersTable).set({
      status: "cancelled", claimToken: null, claimedAt: null, lastFailure: "event_already_claimed",
      updatedAt: now,
    }).where(and(
      eq(gameOnScheduledRemindersTable.id, row.id),
      eq(gameOnScheduledRemindersTable.claimToken, claimed.token),
    ));
    return { sent: false, failed: false };
  }

  const latestAttempts = await getLatestAttemptStatuses(row.id);
  const terminal = new Set<AttemptStatus>(["sent", "stale", "permanent", "uncertain"]);
  const completedSubscriptions = [...latestAttempts].filter(([, status]) => terminal.has(status))
    .map(([id]) => id);
  const subscriptions = await db.select({
    id: webPushSubscriptionsTable.id,
    endpoint: webPushSubscriptionsTable.endpoint,
    p256dh: webPushSubscriptionsTable.p256dh,
    auth: webPushSubscriptionsTable.auth,
  }).from(webPushSubscriptionsTable).where(and(
    eq(webPushSubscriptionsTable.ownerClerkUserId, row.ownerClerkUserId),
    ...(completedSubscriptions.length ? [notInArray(webPushSubscriptionsTable.id, completedSubscriptions)] : []),
  )).orderBy(asc(webPushSubscriptionsTable.createdAt)).limit(maxSubscriptions + 1);
  const candidates = subscriptions.slice(0, maxSubscriptions);

  if (candidates.length === 0) {
    const [latest] = await db.select({
      status: gameOnScheduledRemindersTable.status,
    }).from(gameOnScheduledRemindersTable).where(eq(gameOnScheduledRemindersTable.id, row.id)).limit(1);
    const statuses = [...latestAttempts.values()];
    const anySent = statuses.includes("sent");
    const anyUncertain = statuses.includes("uncertain");
    const anyPermanent = statuses.includes("permanent");
    const status: ReminderStatus = anySent ? "sent" : anyUncertain ? "uncertain" : "failed";
    if (!anySent && !anyUncertain && latest?.status === "sending") {
      await releaseOwnerEventClaim(row, eventClaim.eventClaimId);
    }
    await db.update(gameOnScheduledRemindersTable).set({
      status,
      claimToken: null,
      claimedAt: null,
      sentAt: anySent ? now : null,
      lastFailure: anySent ? null : anyUncertain ? "provider_outcome_uncertain"
        : anyPermanent ? "provider_permanent" : "no_retryable_subscriptions",
       nextAttemptAt: row.expiresAt,
      updatedAt: now,
    }).where(and(
      eq(gameOnScheduledRemindersTable.id, row.id),
      eq(gameOnScheduledRemindersTable.claimToken, claimed.token),
    ));
    return { sent: anySent, failed: !anySent && !anyUncertain };
  }

  const results = await Promise.all(candidates.map((subscription) =>
    attemptSubscription(row, claimed.token, subscription, send, now)));
  const latest = await getLatestAttemptStatuses(row.id);
  const statuses = [...latest.values()];
  const anySent = statuses.includes("sent");
  const anyUncertain = statuses.includes("uncertain");
  const anyTemporary = statuses.includes("temporary");
  const anyPermanent = statuses.includes("permanent");
  const unprocessed = subscriptions.length > maxSubscriptions;
  const retryableCount = [...latest.values()].filter((status) => status === "temporary").length;
  const retriesExhausted = row.attemptCount >= MAX_TOTAL_ATTEMPTS;
  const shouldContinue = unprocessed || (anyTemporary && !retriesExhausted);
  let status: ReminderStatus;
  if (shouldContinue) status = anySent || anyUncertain || anyTemporary ? "failed" : "pending";
  else if (anySent) status = "sent";
  else if (anyUncertain) status = "uncertain";
  else status = "failed";

  if (!anySent && !anyUncertain && !shouldContinue) {
    await releaseOwnerEventClaim(row, eventClaim.eventClaimId);
  }
  await db.update(gameOnScheduledRemindersTable).set({
    status,
    claimToken: null,
    claimedAt: null,
    sentAt: status === "sent" ? now : null,
       nextAttemptAt: shouldContinue
         ? (unprocessed ? now : retryAt(now, row.attemptCount))
         : row.expiresAt,
    lastFailure: anySent
      ? null
      : anyUncertain ? "provider_outcome_uncertain"
        : anyTemporary ? "provider_temporary"
          : anyPermanent ? "provider_permanent"
          : status === "failed" ? "all_subscriptions_stale" : null,
    updatedAt: now,
  }).where(and(
    eq(gameOnScheduledRemindersTable.id, row.id),
    eq(gameOnScheduledRemindersTable.claimToken, claimed.token),
  ));

  return {
    sent: results.some((result) => result.status === "sent"),
    failed: results.some((result) =>
      result.status === "temporary" || result.status === "permanent" || result.status === "uncertain"),
  };
}

async function queueCounts(now = new Date()) {
  const [rows, [due]] = await Promise.all([
    db.select({
      status: gameOnScheduledRemindersTable.status,
      amount: count(),
    }).from(gameOnScheduledRemindersTable).groupBy(gameOnScheduledRemindersTable.status),
    db.select({ amount: count() }).from(gameOnScheduledRemindersTable).where(and(
      inArray(gameOnScheduledRemindersTable.status, ["pending", "failed"]),
      lte(gameOnScheduledRemindersTable.dueAt, now),
      lte(gameOnScheduledRemindersTable.nextAttemptAt, now),
      gt(gameOnScheduledRemindersTable.expiresAt, now),
    )),
  ]);
  const totals = new Map(rows.map((row) => [row.status, Number(row.amount)]));
  return {
    pending: totals.get("pending") ?? 0,
    sent: totals.get("sent") ?? 0,
    failed: totals.get("failed") ?? 0,
    uncertain: totals.get("uncertain") ?? 0,
    cancelled: totals.get("cancelled") ?? 0,
    due: Number(due?.amount ?? 0),
  };
}

export async function getScheduledGameOnStatus() {
  const [runner] = await db.select({ lastSuccessAt: gameOnReminderSyncTable.lastSuccessAt })
    .from(gameOnReminderSyncTable).where(eq(gameOnReminderSyncTable.key, RUNNER_STATE_KEY)).limit(1);
  return { lastSuccessAt: runner?.lastSuccessAt ?? null, ...(await queueCounts()) };
}

export async function runScheduledGameOnReminders(now = new Date(), dependencies: JobDependencies = {}) {
  const startedAt = Date.now();
  const syncPageSize = dependencies.syncPageSize ?? SYNC_PAGE_SIZE;
  const maxReminders = dependencies.maxRemindersPerRun ?? MAX_REMINDERS_PER_RUN;
  const maxSubscriptions = dependencies.maxSubscriptionsPerReminder ?? MAX_SUBSCRIPTIONS_PER_REMINDER;
  const send = dependencies.sendPushNotificationToSubscription ?? defaultSender;
  let synced = 0;
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let syncErrors = 0;
  let deadlineDeferred = false;
  let succeeded = false;

  try {
    try {
      synced += await processSyncPage(GLOBAL_SYNC_KEY, null, syncPageSize,
        startedAt + OWNER_SYNC_BUDGET_MS);
    } catch {
      syncErrors += 1;
      logger.warn("Game On reminder backfill page failed");
    }

    const [ownerRequest] = await db.select({ key: gameOnReminderSyncTable.key })
      .from(gameOnReminderSyncTable)
      .where(and(
        sql`${gameOnReminderSyncTable.key} like 'owner:%'`,
        isNull(gameOnReminderSyncTable.lastSuccessAt),
      ))
      .orderBy(asc(gameOnReminderSyncTable.updatedAt))
      .limit(1);
    if (ownerRequest && Date.now() - startedAt < OWNER_SYNC_BUDGET_MS) {
      const ownerClerkUserId = ownerRequest.key.slice("owner:".length);
      try {
        synced += await processSyncPage(ownerRequest.key, ownerClerkUserId, syncPageSize,
          startedAt + DELIVERY_START_BUDGET_MS);
      } catch {
        syncErrors += 1;
        logger.warn("Game On reminder owner sync page failed");
      }
    }

    deadlineDeferred = Date.now() - startedAt >= DELIVERY_START_BUDGET_MS;
    const claimed = deadlineDeferred ? [] : await claimDueReminders(now, maxReminders);
    processed = claimed.length;
    const outcomes = await Promise.all(claimed.map(async (item) => {
      try {
        return await deliverClaimedReminder(item, now, send, maxSubscriptions);
      } catch {
        // Unexpected local/database failures are not retried immediately. If
        // the process failed after contacting a provider, no blind resend is
        // safe; leave the claim to age into the uncertain state.
        logger.error({ category: "reminder_processing" }, "Game On reminder processing failed");
        return { sent: false, failed: true };
      }
    }));
    sent = outcomes.filter((outcome) => outcome.sent).length;
    failed = outcomes.filter((outcome) => outcome.failed).length;
    succeeded = true;
  } finally {
    if (succeeded) {
      await db.insert(gameOnReminderSyncTable).values({
        key: RUNNER_STATE_KEY,
        cursor: null,
        lastSuccessAt: now,
      }).onConflictDoUpdate({
        target: gameOnReminderSyncTable.key,
        set: { lastSuccessAt: now, updatedAt: now },
      });
    }
  }

  const counts = await queueCounts(now);
  const result = {
    processed,
    sent,
    failed,
    pending: counts.pending,
    uncertain: counts.uncertain,
    due: counts.due,
    synced,
    syncErrors,
    deadlineDeferred,
    durationMs: Date.now() - startedAt,
    moreDue: counts.due > 0,
    lastSuccessAt: now,
  };
  logger.info({
    processed: result.processed,
    sent: result.sent,
    failed: result.failed,
    pending: result.pending,
    uncertain: result.uncertain,
    synced: result.synced,
    syncErrors: result.syncErrors,
    deadlineDeferred: result.deadlineDeferred,
    durationMs: result.durationMs,
  }, "Game On reminder queue check completed");
  return result;
}