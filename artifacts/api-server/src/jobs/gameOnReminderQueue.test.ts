import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  gameOnReminderAttemptsTable,
  gameOnScheduledRemindersTable,
  plannerNotificationPreferencesTable,
  plannerOwnerEventAlertClaimsTable,
  scheduleSharesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import {
  isGameOnAlertScheduleFresh,
  getScheduledGameOnStatus,
  reconcileGameOnShare,
  runScheduledGameOnReminders,
} from "./gameOnReminderQueue";

const GAME_ON_CARD_MARKER = "@pixlsports:game-on-card:v1";
const EVENT_DATE = "2026-09-28";
const ONE_HOUR_DUE = new Date("2026-09-28T17:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: `queue-event-${randomUUID()}`,
    type: "game",
    status: "upcoming",
    date: EVENT_DATE,
    time: "18:00",
    timezone: "UTC",
    ...overrides,
  };
}

async function setup(options: {
  timezone?: string;
  eventTimezone?: string;
  devices?: number;
} = {}) {
  const ownerClerkUserId = `game-on-queue-test-${randomUUID()}`;
  const eventData = event(options.eventTimezone ? { timezone: options.eventTimezone } : {});
  const [share] = await db.insert(scheduleSharesTable).values({
    ownerClerkUserId,
    title: "Private test card",
    teamSeason: GAME_ON_CARD_MARKER,
    events: [eventData],
  }).returning({
    id: scheduleSharesTable.id,
    ownerClerkUserId: scheduleSharesTable.ownerClerkUserId,
    title: scheduleSharesTable.title,
    teamSeason: scheduleSharesTable.teamSeason,
    events: scheduleSharesTable.events,
  });
  const subscriptions: string[] = [];
  for (let index = 0; index < (options.devices ?? 1); index += 1) {
    const [subscription] = await db.insert(webPushSubscriptionsTable).values({
      ownerClerkUserId,
      endpoint: `https://fcm.googleapis.com/wp/queue-test-${randomUUID()}`,
      p256dh: `queue-test-p256dh-${index}`,
      auth: `queue-test-auth-${index}`,
      timezone: options.timezone ?? "UTC",
    }).returning({ id: webPushSubscriptionsTable.id });
    subscriptions.push(subscription!.id);
  }
  await db.insert(plannerNotificationPreferencesTable).values({
    ownerClerkUserId,
    oneHourBefore: true,
    dayOf: false,
  });
  const cleanup = async () => {
    await db.delete(gameOnReminderAttemptsTable)
      .where(inArray(gameOnReminderAttemptsTable.reminderId, inArrayByReminder(share.id)));
    await db.delete(gameOnScheduledRemindersTable).where(eq(gameOnScheduledRemindersTable.shareId, share.id));
    await db.delete(plannerOwnerEventAlertClaimsTable)
      .where(eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, ownerClerkUserId));
    await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, share.id));
    await db.delete(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerClerkUserId));
    await db.delete(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId));
  };
  return { share, eventData, ownerClerkUserId, subscriptions, cleanup };
}

function inArrayByReminder(shareId: string) {
  return db.select({ id: gameOnScheduledRemindersTable.id })
    .from(gameOnScheduledRemindersTable)
    .where(eq(gameOnScheduledRemindersTable.shareId, shareId));
}

async function queueOneHour(fixture: Awaited<ReturnType<typeof setup>>, now = ONE_HOUR_DUE) {
  await reconcileGameOnShare(fixture.share, new Date("2026-09-20T00:00:00.000Z"));
  const rows = await db.select().from(gameOnScheduledRemindersTable).where(and(
    eq(gameOnScheduledRemindersTable.shareId, fixture.share.id),
    eq(gameOnScheduledRemindersTable.reminderType, "one_hour"),
  ));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dueAt.toISOString(), now.toISOString());
  return rows[0]!;
}

test("reconciliation stores UTC due times and keeps event and account time zones distinct", async () => {
  const west = await setup({ timezone: "America/Los_Angeles", eventTimezone: "America/New_York" });
  const legacy = await setup({ timezone: "America/Los_Angeles", eventTimezone: "" });
  try {
    await reconcileGameOnShare(west.share, new Date("2026-09-20T00:00:00.000Z"));
    await db.update(scheduleSharesTable)
      .set({ events: [{ ...legacy.eventData, timezone: undefined }] })
      .where(eq(scheduleSharesTable.id, legacy.share.id));
    const legacyShare = { ...legacy.share, events: [{ ...legacy.eventData, timezone: undefined }] };
    await reconcileGameOnShare(legacyShare, new Date("2026-09-20T00:00:00.000Z"));
    const [newYork] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, west.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "one_hour"),
    ));
    const [losAngeles] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, legacy.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "one_hour"),
    ));
    assert.equal(newYork?.timezone, "America/Los_Angeles");
    assert.equal(newYork?.dueAt.toISOString(), "2026-09-28T21:00:00.000Z");
    assert.equal(losAngeles?.timezone, "America/Los_Angeles");
    assert.equal(losAngeles?.dueAt.toISOString(), "2026-09-29T00:00:00.000Z");
  } finally {
    await west.cleanup();
    await legacy.cleanup();
  }
});

test("day-of Event Card reminders use the account's saved alert time zone", async () => {
  const fixture = await setup({ timezone: "America/New_York", eventTimezone: "America/New_York" });
  try {
    await db.update(plannerNotificationPreferencesTable).set({
      oneHourBefore: false,
      dayOf: true,
      timezone: "America/Los_Angeles",
    }).where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, fixture.ownerClerkUserId));

    await reconcileGameOnShare(fixture.share, new Date("2026-09-20T00:00:00.000Z"));
    const [dayOf] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, fixture.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "day_of"),
    ));

    assert.equal(dayOf?.timezone, "America/Los_Angeles");
    assert.equal(dayOf?.dueAt.toISOString(), "2026-09-28T14:00:00.000Z");
  } finally {
    await fixture.cleanup();
  }
});

test("a changed alert time zone reschedules day-of delivery without sending at the old time", async () => {
  const fixture = await setup({ timezone: "America/New_York", eventTimezone: "America/New_York" });
  let sends = 0;
  try {
    await db.update(plannerNotificationPreferencesTable).set({
      oneHourBefore: false,
      dayOf: true,
      timezone: "America/New_York",
    }).where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, fixture.ownerClerkUserId));
    await reconcileGameOnShare(fixture.share, new Date("2026-09-20T00:00:00.000Z"));

    const [original] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, fixture.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "day_of"),
    ));
    assert.equal(original?.dueAt.toISOString(), "2026-09-28T11:00:00.000Z");

    await db.update(plannerNotificationPreferencesTable).set({ timezone: "America/Los_Angeles" })
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, fixture.ownerClerkUserId));
    await reconcileGameOnShare(fixture.share, new Date("2026-09-20T00:00:00.000Z"));

    const [rescheduled] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, fixture.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "day_of"),
    ));
    assert.equal(rescheduled?.timezone, "America/Los_Angeles");
    assert.equal(rescheduled?.dueAt.toISOString(), "2026-09-28T14:00:00.000Z");

    const dependencies = {
      sendPushNotificationToSubscription: async () => {
        sends += 1;
        return { configured: true, sent: true, stale: false };
      },
      syncPageSize: 0,
    };
    await runScheduledGameOnReminders(new Date("2026-09-28T11:00:00.000Z"), dependencies);
    assert.equal(sends, 0);
    const [stillPending] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, rescheduled!.id));
    assert.equal(stillPending?.status, "pending");

    await runScheduledGameOnReminders(new Date("2026-09-28T14:00:00.000Z"), dependencies);
    assert.equal(sends, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("scheduled delivery only reports a recent successful server check as active", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  assert.equal(isGameOnAlertScheduleFresh(null, now), false);
  assert.equal(isGameOnAlertScheduleFresh(new Date("2026-09-29T11:44:00.000Z"), now), false);
  assert.equal(isGameOnAlertScheduleFresh(new Date("2026-09-29T11:46:00.000Z"), now), true);
  assert.equal(isGameOnAlertScheduleFresh(new Date("2026-09-29T12:01:00.000Z"), now), false);
});

test("ordinary schedule shares never enter the Game On reminder queue", async () => {
  const fixture = await setup();
  try {
    await reconcileGameOnShare({ ...fixture.share, teamSeason: "ordinary-season" });
    const rows = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.shareId, fixture.share.id));
    assert.equal(rows.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("a replaced card is authoritative and an older card cannot take its event claim", async () => {
  const fixture = await setup();
  let replacementId: string | undefined;
  let sends = 0;
  try {
    await db.update(scheduleSharesTable).set({ updatedAt: new Date("2026-09-20T00:00:00.000Z") })
      .where(eq(scheduleSharesTable.id, fixture.share.id));
    await queueOneHour(fixture);
    const [replacement] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: fixture.ownerClerkUserId,
      title: "Replacement card",
      teamSeason: GAME_ON_CARD_MARKER,
      events: [{ ...fixture.eventData, time: "19:00" }],
    }).returning();
    replacementId = replacement!.id;
    await reconcileGameOnShare(replacement!, new Date("2026-09-20T00:00:00.000Z"));
    const send = async () => {
      sends += 1;
      return { configured: true, sent: true, stale: false } as const;
    };
    await runScheduledGameOnReminders(ONE_HOUR_DUE, {
      sendPushNotificationToSubscription: send, syncPageSize: 0,
    });
    assert.equal(sends, 0);
    await runScheduledGameOnReminders(new Date("2026-09-28T18:00:00.000Z"), {
      sendPushNotificationToSubscription: send, syncPageSize: 0,
    });
    assert.equal(sends, 1);
  } finally {
    if (replacementId) await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, replacementId));
    await fixture.cleanup();
  }
});

test("retry exhaustion remains terminal through subsequent reconciliation", async () => {
  const fixture = await setup();
  let sends = 0;
  try {
    const row = await queueOneHour(fixture);
    await db.update(gameOnScheduledRemindersTable).set({
      status: "failed", attemptCount: 12, nextAttemptAt: row.expiresAt,
    }).where(eq(gameOnScheduledRemindersTable.id, row.id));
    await reconcileGameOnShare(fixture.share, ONE_HOUR_DUE);
    await runScheduledGameOnReminders(ONE_HOUR_DUE, {
      sendPushNotificationToSubscription: async () => {
        sends += 1;
        return { configured: true, sent: true, stale: false };
      },
      syncPageSize: 0,
    });
    const [stored] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, row.id));
    assert.equal(stored?.status, "failed");
    assert.equal(stored?.attemptCount, 12);
    assert.equal(sends, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("a successful reminder is recorded once and repeated job checks do not resend it", async () => {
  const fixture = await setup();
  let sends = 0;
  try {
    const row = await queueOneHour(fixture);
    const send = async () => {
      sends += 1;
      return { configured: true, sent: true, stale: false } as const;
    };
    const dependencies = { sendPushNotificationToSubscription: send, syncPageSize: 0 };
    const first = await runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    const second = await runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    assert.equal(first.processed, 1);
    assert.equal(first.sent, 1);
    assert.equal(second.processed, 0);
    assert.equal(sends, 1);
    const [stored] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, row.id));
    assert.equal(stored?.status, "sent");
    assert.equal(stored?.sentAt?.toISOString(), ONE_HOUR_DUE.toISOString());
    const claims = await db.select().from(plannerOwnerEventAlertClaimsTable)
      .where(eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, fixture.ownerClerkUserId));
    assert.equal(claims.length, 1);
    const status = await getScheduledGameOnStatus();
    assert.ok(status.lastSuccessAt);
    assert.ok(status.sent >= 1);
  } finally {
    await fixture.cleanup();
  }
});

test("retry targets only a device with a known temporary failure", async () => {
  const fixture = await setup({ devices: 2 });
  const sends = new Map<string, number>();
  try {
    await queueOneHour(fixture);
    const send = async (subscription: { id: string }) => {
      const count = (sends.get(subscription.id) ?? 0) + 1;
      sends.set(subscription.id, count);
      if (subscription.id === fixture.subscriptions[1] && count === 1) {
        return { configured: true, sent: false, stale: false, failure: "temporary" as const };
      }
      return { configured: true, sent: true, stale: false };
    };
    const dependencies = {
      sendPushNotificationToSubscription: send,
      maxSubscriptionsPerReminder: 2,
      syncPageSize: 0,
    };
    await runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    const [retryRow] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, fixture.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "one_hour"),
    ));
    assert.equal(retryRow?.status, "failed");
    await reconcileGameOnShare(fixture.share, ONE_HOUR_DUE);
    const [preservedRetry] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, retryRow!.id));
    assert.equal(preservedRetry?.status, "failed");
    assert.equal(preservedRetry?.eventClaimId, retryRow?.eventClaimId);
    assert.equal(preservedRetry?.nextAttemptAt.toISOString(), retryRow?.nextAttemptAt.toISOString());
    await db.update(gameOnScheduledRemindersTable).set({
      nextAttemptAt: new Date(ONE_HOUR_DUE.getTime() + 60_000),
    }).where(eq(gameOnScheduledRemindersTable.shareId, fixture.share.id));
    await runScheduledGameOnReminders(new Date(ONE_HOUR_DUE.getTime() + 60_000), dependencies);
    assert.equal(sends.get(fixture.subscriptions[0]!), 1);
    assert.equal(sends.get(fixture.subscriptions[1]!), 2);
    const attempts = await db.select().from(gameOnReminderAttemptsTable).where(
      inArray(gameOnReminderAttemptsTable.reminderId, inArrayByReminder(fixture.share.id)),
    );
    assert.equal(attempts.length, 3);
    assert.equal(attempts.filter((attempt) => attempt.status === "sent").length, 2);
    assert.equal(attempts.filter((attempt) => attempt.status === "temporary").length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("overlapping checks claim a due reminder once", async () => {
  const fixture = await setup();
  let sends = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    await queueOneHour(fixture);
    const send = async () => {
      sends += 1;
      await barrier;
      return { configured: true, sent: true, stale: false };
    };
    const dependencies = { sendPushNotificationToSubscription: send, syncPageSize: 0 };
    const first = runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const results = await Promise.all([first, second]);
    assert.equal(sends, 1);
    assert.equal(results.reduce((sum, result) => sum + result.processed, 0), 1);
  } finally {
    release();
    await fixture.cleanup();
  }
});

test("the per-run reminder limit leaves overflow queued for the next check", async () => {
  const fixtures = await Promise.all([setup(), setup(), setup()]);
  let sends = 0;
  try {
    await Promise.all(fixtures.map((fixture) => queueOneHour(fixture)));
    const dependencies = {
      maxRemindersPerRun: 2,
      syncPageSize: 0,
      sendPushNotificationToSubscription: async () => {
        sends += 1;
        return { configured: true, sent: true, stale: false };
      },
    };
    const first = await runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    assert.equal(first.processed, 2);
    assert.equal(sends, 2);
    const second = await runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    assert.equal(second.processed, 1);
    assert.equal(sends, 3);
  } finally {
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
  }
});

test("a missed one-hour check can recover with capture-open without duplicating a successful one-hour push", async () => {
  const missed = await setup();
  let missedSends = 0;
  try {
    await reconcileGameOnShare(missed.share, new Date("2026-09-20T00:00:00.000Z"));
    await runScheduledGameOnReminders(new Date("2026-09-28T18:30:00.000Z"), {
      sendPushNotificationToSubscription: async (_subscription, payload) => {
        missedSends += 1;
        assert.match(payload.title, /CAPTURE OPEN/);
        return { configured: true, sent: true, stale: false };
      },
      syncPageSize: 0,
    });
    assert.equal(missedSends, 1);
    const [capture] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, missed.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "capture_open"),
    ));
    assert.equal(capture?.status, "sent");
  } finally {
    await missed.cleanup();
  }

  const successful = await setup();
  let successfulSends = 0;
  try {
    await reconcileGameOnShare(successful.share, new Date("2026-09-20T00:00:00.000Z"));
    await runScheduledGameOnReminders(ONE_HOUR_DUE, {
      sendPushNotificationToSubscription: async () => {
        successfulSends += 1;
        return { configured: true, sent: true, stale: false };
      },
      syncPageSize: 0,
    });
    await runScheduledGameOnReminders(new Date("2026-09-28T18:30:00.000Z"), {
      sendPushNotificationToSubscription: async () => {
        successfulSends += 1;
        return { configured: true, sent: true, stale: false };
      },
      syncPageSize: 0,
    });
    assert.equal(successfulSends, 1);
  } finally {
    await successful.cleanup();
  }
});

test("a known failed one-hour push releases its claim at event start for capture-open", async () => {
  const fixture = await setup();
  const delivered: string[] = [];
  try {
    await queueOneHour(fixture);
    await runScheduledGameOnReminders(ONE_HOUR_DUE, {
      syncPageSize: 0,
      sendPushNotificationToSubscription: async (_subscription, payload) => {
        delivered.push(payload.title);
        return { configured: true, sent: false, stale: false, failure: "temporary" as const };
      },
    });
    const [claimed] = await db.select().from(plannerOwnerEventAlertClaimsTable)
      .where(eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, fixture.ownerClerkUserId));
    assert.ok(claimed);
    await runScheduledGameOnReminders(new Date("2026-09-28T18:05:00.000Z"), {
      syncPageSize: 0,
      sendPushNotificationToSubscription: async (_subscription, payload) => {
        delivered.push(payload.title);
        return { configured: true, sent: true, stale: false };
      },
    });
    assert.deepEqual(delivered.map((title) =>
      title.includes("CAPTURE OPEN") ? "capture_open" : "one_hour"), ["one_hour", "capture_open"]);
    const rows = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.shareId, fixture.share.id));
    assert.equal(rows.find((row) => row.reminderType === "one_hour")?.status, "cancelled");
    assert.equal(rows.find((row) => row.reminderType === "capture_open")?.status, "sent");
  } finally {
    await fixture.cleanup();
  }
});

test("a push with uncertain outcome is not retried and keeps the owner claim", async () => {
  const fixture = await setup();
  let sends = 0;
  try {
    await queueOneHour(fixture);
    const dependencies = {
      sendPushNotificationToSubscription: async () => {
        sends += 1;
        return { configured: true, sent: false, stale: false, failure: "uncertain" as const };
      },
      syncPageSize: 0,
    };
    await runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    await runScheduledGameOnReminders(new Date(ONE_HOUR_DUE.getTime() + 5 * 60_000), dependencies);
    await runScheduledGameOnReminders(new Date("2026-09-28T18:05:00.000Z"), dependencies);
    assert.equal(sends, 1);
    const [row] = await db.select().from(gameOnScheduledRemindersTable).where(and(
      eq(gameOnScheduledRemindersTable.shareId, fixture.share.id),
      eq(gameOnScheduledRemindersTable.reminderType, "one_hour"),
    ));
    assert.equal(row?.status, "uncertain");
    const claims = await db.select().from(plannerOwnerEventAlertClaimsTable)
      .where(eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, fixture.ownerClerkUserId));
    assert.equal(claims.length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("a transport timeout is recorded as uncertain rather than automatically resent", async () => {
  const fixture = await setup();
  let sends = 0;
  try {
    const row = await queueOneHour(fixture);
    const dependencies = {
      sendPushNotificationToSubscription: async (_subscription: unknown, _payload: unknown, timeoutMs?: number) => {
        assert.equal(timeoutMs, 8_000);
        sends += 1;
        throw new Error("synthetic network timeout");
      },
      syncPageSize: 0,
    };
    await runScheduledGameOnReminders(ONE_HOUR_DUE, dependencies);
    await runScheduledGameOnReminders(new Date(ONE_HOUR_DUE.getTime() + 5 * 60_000), dependencies);
    const attempts = await db.select().from(gameOnReminderAttemptsTable)
      .where(eq(gameOnReminderAttemptsTable.reminderId, row.id));
    assert.equal(sends, 1);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, "uncertain");
  } finally {
    await fixture.cleanup();
  }
});

test("changing preferences cancels queued work before sending", async () => {
  const fixture = await setup();
  let sends = 0;
  try {
    const row = await queueOneHour(fixture);
    await db.update(plannerNotificationPreferencesTable).set({ oneHourBefore: false })
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, fixture.ownerClerkUserId));
    await runScheduledGameOnReminders(ONE_HOUR_DUE, {
      sendPushNotificationToSubscription: async () => {
        sends += 1;
        return { configured: true, sent: true, stale: false };
      },
      syncPageSize: 0,
    });
    const [cancelled] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, row.id));
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(sends, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("an edited or finalized event is cancelled at send time", async () => {
  const edited = await setup();
  const finalized = await setup();
  let sends = 0;
  try {
    const editedRow = await queueOneHour(edited);
    const finalizedRow = await queueOneHour(finalized);
    await db.update(scheduleSharesTable).set({
      events: [{ ...edited.eventData, time: "19:00" }],
    }).where(eq(scheduleSharesTable.id, edited.share.id));
    await db.update(scheduleSharesTable).set({
      events: [{ ...finalized.eventData, status: "final" }],
    }).where(eq(scheduleSharesTable.id, finalized.share.id));
    await runScheduledGameOnReminders(ONE_HOUR_DUE, {
      sendPushNotificationToSubscription: async () => {
        sends += 1;
        return { configured: true, sent: true, stale: false };
      },
      syncPageSize: 0,
    });
    const [editedState] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, editedRow.id));
    const [finalizedState] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, finalizedRow.id));
    assert.equal(editedState?.status, "cancelled");
    assert.equal(finalizedState?.status, "cancelled");
    assert.equal(sends, 0);
  } finally {
    await edited.cleanup();
    await finalized.cleanup();
  }
});

test("an abandoned inflight claim recovers as uncertain without a duplicate push", async () => {
  const fixture = await setup();
  let sends = 0;
  try {
    const row = await queueOneHour(fixture);
    const claimToken = randomUUID();
    const staleAt = new Date(ONE_HOUR_DUE.getTime() - 60_000);
    await db.update(gameOnScheduledRemindersTable).set({
      status: "sending",
      claimToken,
      claimedAt: staleAt,
      attemptCount: 1,
    }).where(eq(gameOnScheduledRemindersTable.id, row.id));
    await db.insert(gameOnReminderAttemptsTable).values({
      reminderId: row.id,
      subscriptionId: fixture.subscriptions[0]!,
      status: "sending",
      startedAt: staleAt,
    });
    await runScheduledGameOnReminders(ONE_HOUR_DUE, {
      syncPageSize: 0,
      sendPushNotificationToSubscription: async () => {
        sends += 1;
        return { configured: true, sent: true, stale: false };
      },
    });
    const [stored] = await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, row.id));
    const [attempt] = await db.select().from(gameOnReminderAttemptsTable)
      .where(inArray(gameOnReminderAttemptsTable.reminderId, inArrayByReminder(fixture.share.id)));
    assert.equal(stored?.status, "uncertain");
    assert.equal(attempt?.status, "uncertain");
    assert.equal(sends, 0);
  } finally {
    await fixture.cleanup();
  }
});