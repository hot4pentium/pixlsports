import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import express from "express";
import {
  cloudProjectsTable,
  db,
  plannerCardNotificationDeliveriesTable,
  plannerNotificationDeliveriesTable,
  plannerNotificationPreferencesTable,
  scheduleSharesTable,
  statTrackerSharesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { GAME_ON_CARD_MARKER } from "../routes/scheduleShares";
import webPushRouter from "../routes/webPush";
import {
  getPlannerReminderTypesForTest,
  runPlannerNotificationJob,
} from "./plannerNotifications";

test("planner reminders use each subscription's local event time", () => {
  const cases = [
    {
      timezone: "America/New_York",
      eventDate: "2026-01-15",
      eventTime: "10:00",
      beforeReminder: "2026-01-15T13:59:00.000Z",
      reminder: "2026-01-15T14:00:00.000Z",
      eventStart: "2026-01-15T15:00:00.000Z",
    },
    {
      timezone: "America/Los_Angeles",
      eventDate: "2026-01-15",
      eventTime: "10:00 AM",
      beforeReminder: "2026-01-15T16:59:00.000Z",
      reminder: "2026-01-15T17:00:00.000Z",
      eventStart: "2026-01-15T18:00:00.000Z",
    },
  ];

  for (const current of cases) {
    assert.deepEqual(
      getPlannerReminderTypesForTest(current.eventDate, current.eventTime, new Date(current.beforeReminder), current.timezone),
      [],
    );
    assert.deepEqual(
      getPlannerReminderTypesForTest(current.eventDate, current.eventTime, new Date(current.reminder), current.timezone),
      ["one_hour"],
    );
    assert.deepEqual(
      getPlannerReminderTypesForTest(current.eventDate, current.eventTime, new Date(current.eventStart), current.timezone),
      ["capture_open"],
    );
    assert.deepEqual(
      getPlannerReminderTypesForTest(
        current.eventDate,
        current.eventTime,
        new Date(new Date(current.eventStart).getTime() + 3 * 60 * 60 * 1000),
        current.timezone,
      ),
      [],
    );
  }
});

test("planner reminders keep one-hour timing correct across daylight-saving transitions", () => {
  assert.deepEqual(
    getPlannerReminderTypesForTest(
      "2026-03-08",
      "10:00",
      new Date("2026-03-08T13:00:00.000Z"),
      "America/New_York",
    ),
    ["one_hour"],
  );
  assert.deepEqual(
    getPlannerReminderTypesForTest(
      "2026-11-01",
      "10:00",
      new Date("2026-11-01T14:00:00.000Z"),
      "America/New_York",
    ),
    ["one_hour"],
  );
});

test("day-of reminders arrive at 7 AM locally and can be selected independently", () => {
  const eventDate = "2026-09-23";
  const dayOf = { oneHourBefore: false, dayOf: true };

  assert.deepEqual(
    getPlannerReminderTypesForTest(eventDate, "18:00", new Date("2026-09-23T10:59:00.000Z"), "America/New_York", dayOf),
    [],
  );
  assert.deepEqual(
    getPlannerReminderTypesForTest(eventDate, "18:00", new Date("2026-09-23T11:00:00.000Z"), "America/New_York", dayOf),
    ["day_of"],
  );
  assert.deepEqual(
    getPlannerReminderTypesForTest(eventDate, "18:00", new Date("2026-09-23T22:00:00.000Z"), "America/New_York", dayOf),
    [],
  );
  assert.deepEqual(
    getPlannerReminderTypesForTest(eventDate, "18:00", new Date("2026-09-23T11:00:00.000Z"), "America/New_York", { oneHourBefore: true, dayOf: true }),
    ["day_of"],
  );
});

test("planner job uses the most recently updated subscription timezone", async () => {
  const ownerId = `planner-timezone-test-${randomUUID()}`;
  const sent: Array<{ title: string }> = [];
  const shareIds: string[] = [];
  let projectId: string | undefined;

  try {
    await db.insert(webPushSubscriptionsTable).values([
      {
        ownerClerkUserId: ownerId,
        endpoint: `https://push.example.test/old-${randomUUID()}`,
        p256dh: "old-p256dh",
        auth: "old-auth",
        timezone: "UTC",
        updatedAt: new Date("2026-09-22T12:00:00.000Z"),
      },
      {
        ownerClerkUserId: ownerId,
        endpoint: `https://push.example.test/current-${randomUUID()}`,
        p256dh: "current-p256dh",
        auth: "current-auth",
        timezone: "America/New_York",
        updatedAt: new Date("2026-09-23T11:00:00.000Z"),
      },
    ]);
    const [share] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Standalone Game On Card",
      teamSeason: GAME_ON_CARD_MARKER,
      events: [cardEvent({
        id: "timezone-card-game",
        date: "2026-09-23",
        time: "2:50 PM",
      })],
    }).returning({ id: scheduleSharesTable.id });
    shareIds.push(share.id);
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Legacy Calendar timezone test",
      project: {
        tool: "schedule",
        teamName: "Test Team",
        season: "2026",
        events: [{
          id: "legacy-meeting",
          type: "meeting",
          date: "2026-09-23",
          time: "14:50",
          location: "Main office",
          opponent: "",
        }],
      },
    }).returning();
    projectId = project.id;

    await runPlannerNotificationJob(new Date("2026-09-23T17:50:00.000Z"), {
      sendPushNotificationToUser: async (_ownerId, payload) => {
        sent.push({ title: payload.title });
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.deepEqual(sent, [{ title: "GAME DAY · IN 1 HOUR" }]);
    const cardDeliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, share.id));
    assert.equal(cardDeliveries.length, 1);
    assert.equal(cardDeliveries[0]?.notificationType, "one_hour");
    assert.equal(cardDeliveries[0]?.eventDate, "2026-09-23");
    const projectDeliveries = await db.select()
      .from(plannerNotificationDeliveriesTable)
      .where(eq(plannerNotificationDeliveriesTable.projectId, project.id));
    assert.equal(projectDeliveries.length, 0);
  } finally {
    for (const shareId of shareIds) {
      await db.delete(plannerCardNotificationDeliveriesTable)
        .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
      await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, shareId));
    }
    if (projectId) {
      await db.delete(plannerNotificationDeliveriesTable)
        .where(eq(plannerNotificationDeliveriesTable.projectId, projectId));
      await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, projectId));
    }
    await db.delete(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerId));
  }
});

test("planner job skips invalid dates, sends valid events, and deduplicates repeated runs", async () => {
  const ownerId = `planner-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let projectId: string | undefined;
  const sent: Array<{ ownerId: string; tag?: string; title: string }> = [];

  try {
    await addPlannerSubscription(ownerId, "America/New_York");
    const [share] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Standalone Game On Card",
      teamSeason: GAME_ON_CARD_MARKER,
      events: [cardEvent({
        id: "event-1",
        date: "2026-09-27",
        time: "2:50 PM",
      })],
    }).returning({ id: scheduleSharesTable.id });
    shareIds.push(share.id);
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Legacy Calendar-only notification test",
      project: {
        tool: "schedule",
        teamName: "Test Team",
        season: "2026",
        events: [
          {
            id: "invalid-date",
            type: "game",
            date: "2026-09-31",
            opponent: "Ignored",
          },
          {
            id: "legacy-event",
            type: "game",
            status: "upcoming",
            date: "2026-09-27",
            time: "14:50",
            location: "Main Gym",
            opponent: "Falcons",
          },
        ],
      },
    }).returning();
    projectId = project.id;

    const dependencies = {
      sendPushNotificationToUser: async (
        sentOwnerId: string,
        payload: { title: string; tag?: string },
      ) => {
        sent.push({ ownerId: sentOwnerId, title: payload.title, tag: payload.tag });
        return { configured: true, sent: 1, removed: 0 };
      },
    };
    const oneHourBefore = new Date("2026-09-27T17:50:00.000Z");

    await runPlannerNotificationJob(oneHourBefore, dependencies);
    await runPlannerNotificationJob(oneHourBefore, dependencies);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.ownerId, ownerId);
    assert.equal(sent[0]?.title, "GAME DAY · IN 1 HOUR");
    assert.match(sent[0]?.tag ?? "", /event-1-one_hour-2026-09-27/);

    const deliveriesAfterRepeat = await db
      .select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, share.id));
    assert.equal(deliveriesAfterRepeat.length, 1);
    assert.equal(deliveriesAfterRepeat[0]?.eventDate, "2026-09-27");

    await db.update(scheduleSharesTable).set({
      events: [cardEvent({
        id: "event-1",
        date: "2026-09-28",
        time: "2:50 PM",
      })],
    }).where(eq(scheduleSharesTable.id, share.id));

    await runPlannerNotificationJob(new Date("2026-09-28T17:50:00.000Z"), dependencies);

    assert.equal(sent.length, 2);
    assert.match(sent[1]?.tag ?? "", /event-1-one_hour-2026-09-28/);
    const deliveriesAfterDateChange = await db
      .select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(and(
        eq(plannerCardNotificationDeliveriesTable.shareId, share.id),
        eq(plannerCardNotificationDeliveriesTable.eventId, "event-1"),
      ));
    assert.deepEqual(
      deliveriesAfterDateChange.map((delivery) => delivery.eventDate).sort(),
      ["2026-09-27", "2026-09-28"],
    );
    const legacyProjectDeliveries = await db.select()
      .from(plannerNotificationDeliveriesTable)
      .where(eq(plannerNotificationDeliveriesTable.projectId, project.id));
    assert.equal(legacyProjectDeliveries.length, 0);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
    if (projectId) {
      await db.delete(plannerNotificationDeliveriesTable)
        .where(eq(plannerNotificationDeliveriesTable.projectId, projectId));
      await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, projectId));
    }
  }
});

const cardEvent = (overrides: Record<string, unknown> = {}) => ({
  id: "game-on-card-event",
  type: "game",
  status: "upcoming",
  date: "2026-09-27",
  time: "14:50",
  location: "Main Field",
  opponent: "Falcons",
  ...overrides,
});

async function insertGameOnCard(ownerId: string, events: unknown[] = [cardEvent()]) {
  const [share] = await db.insert(scheduleSharesTable).values({
    ownerClerkUserId: ownerId,
    title: "Standalone Game On Card",
    teamSeason: GAME_ON_CARD_MARKER,
    events,
  }).returning({ id: scheduleSharesTable.id });
  return share.id;
}

async function addPlannerSubscription(ownerId: string, timezone = "UTC") {
  await db.insert(webPushSubscriptionsTable).values({
    ownerClerkUserId: ownerId,
    endpoint: `https://push.example.test/${randomUUID()}`,
    p256dh: "card-test-p256dh",
    auth: "card-test-auth",
    timezone,
  });
}

async function cleanCardFixture(ownerId: string, shareIds: string[], projectIds: string[] = []) {
  for (const shareId of shareIds) {
    await db.delete(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, shareId));
  }
  for (const projectId of projectIds) {
    await db.delete(plannerNotificationDeliveriesTable)
      .where(eq(plannerNotificationDeliveriesTable.projectId, projectId));
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, projectId));
  }
  await db.delete(plannerNotificationPreferencesTable)
    .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerId));
  await db.delete(webPushSubscriptionsTable)
    .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerId));
}

test("planner sends and records a one-hour reminder for a standalone Game On Card", async () => {
  const ownerId = `planner-card-test-${randomUUID()}`;
  const shareIds: string[] = [];
  const sent: Array<{ ownerId: string; title: string; body: string; tag?: string }> = [];

  try {
    await addPlannerSubscription(ownerId);
    shareIds.push(await insertGameOnCard(ownerId));

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      sendPushNotificationToUser: async (sentOwnerId, payload) => {
        sent.push({ ownerId: sentOwnerId, title: payload.title, body: payload.body, tag: payload.tag });
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.ownerId, ownerId);
    assert.equal(sent[0]?.title, "GAME DAY · IN 1 HOUR");
    assert.equal(sent[0]?.body, "Open Pixl Sports to see your Game On Card.");
    for (const privateDetail of ["Falcons", "Main Field", "Standalone Game On Card"]) {
      assert.equal(sent[0]?.body.includes(privateDetail), false);
    }
    assert.match(sent[0]?.tag ?? "", /^planner-card-/);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareIds[0]!));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.eventId, "game-on-card-event");
    assert.equal(deliveries[0]?.eventDate, "2026-09-27");
    assert.equal(deliveries[0]?.notificationType, "one_hour");
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("planner releases its claim when the card date changes before eligibility recheck", async () => {
  const ownerId = `planner-card-recheck-edit-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;
  let hookCount = 0;

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      beforeEligibilityRecheck: async (claimedShareId) => {
        assert.equal(claimedShareId, shareId);
        hookCount += 1;
        await db.update(scheduleSharesTable).set({
          events: [cardEvent({ date: "2026-09-28" })],
        }).where(eq(scheduleSharesTable.id, shareId));
      },
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.equal(hookCount, 1);
    assert.equal(sendCount, 0);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(deliveries.length, 0);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("planner releases its claim when a tracker game is finalized before eligibility recheck", async () => {
  const ownerId = `planner-card-recheck-tracker-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;
  let hookCount = 0;
  const event = cardEvent({ id: "recheck-tracker-game" });

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId, [event]);
    shareIds.push(shareId);
    await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: event.id,
      athleteName: "Recheck Test Athlete",
      teamName: "Recheck Test Team",
      game: { status: "live" },
      expiresAt: new Date("2026-09-28T13:50:00.000Z"),
    });

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      beforeEligibilityRecheck: async (claimedShareId) => {
        assert.equal(claimedShareId, shareId);
        hookCount += 1;
        await db.update(statTrackerSharesTable).set({
          game: { status: "final" },
        }).where(and(
          eq(statTrackerSharesTable.ownerClerkUserId, ownerId),
          eq(statTrackerSharesTable.gameId, event.id),
        ));
      },
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.equal(hookCount, 1);
    assert.equal(sendCount, 0);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(deliveries.length, 0);
  } finally {
    await db.delete(statTrackerSharesTable)
      .where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("planner releases its claim when reminder preference is disabled before eligibility recheck", async () => {
  const ownerId = `planner-card-recheck-preference-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;
  let hookCount = 0;

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      beforeEligibilityRecheck: async (claimedShareId) => {
        assert.equal(claimedShareId, shareId);
        hookCount += 1;
        await db.insert(plannerNotificationPreferencesTable).values({
          ownerClerkUserId: ownerId,
          oneHourBefore: false,
          dayOf: false,
        });
      },
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.equal(hookCount, 1);
    assert.equal(sendCount, 0);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(deliveries.length, 0);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("planner sends one-hour practice reminders from Game On Cards", async () => {
  const ownerId = `planner-card-practice-test-${randomUUID()}`;
  const shareIds: string[] = [];
  const sentTitles: string[] = [];

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId, [
      cardEvent({ id: "practice-event", type: "practice" }),
    ]);
    shareIds.push(shareId);

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      sendPushNotificationToUser: async (_sentOwnerId, payload) => {
        sentTitles.push(payload.title);
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.deepEqual(sentTitles, ["PRACTICE · IN 1 HOUR"]);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.eventId, "practice-event");
    assert.equal(deliveries[0]?.notificationType, "one_hour");
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("planner honors card reminder preference toggles", async () => {
  const ownerId = `planner-card-preferences-test-${randomUUID()}`;
  const shareIds: string[] = [];
  const sentTitles: string[] = [];
  const dependencies = {
    sendPushNotificationToUser: async (_sentOwnerId: string, payload: { title: string }) => {
      sentTitles.push(payload.title);
      return { configured: true, sent: 1, removed: 0 };
    },
  };

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    await db.insert(plannerNotificationPreferencesTable).values({
      ownerClerkUserId: ownerId,
      oneHourBefore: false,
      dayOf: false,
    });

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), dependencies);
    assert.deepEqual(sentTitles, []);
    await db.update(plannerNotificationPreferencesTable).set({
      oneHourBefore: false,
      dayOf: true,
    }).where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerId));
    await runPlannerNotificationJob(new Date("2026-09-27T07:00:00.000Z"), dependencies);
    assert.deepEqual(sentTitles, ["GAME DAY · TODAY"]);

    await db.update(plannerNotificationPreferencesTable).set({
      oneHourBefore: true,
      dayOf: false,
    }).where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerId));
    await db.update(scheduleSharesTable).set({
      events: [cardEvent({ date: "2026-09-28" })],
    }).where(eq(scheduleSharesTable.id, shareId));
    await runPlannerNotificationJob(new Date("2026-09-28T13:50:00.000Z"), dependencies);
    assert.deepEqual(sentTitles, ["GAME DAY · TODAY", "GAME DAY · IN 1 HOUR"]);

    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.deepEqual(
      deliveries.map((delivery) => delivery.notificationType).sort(),
      ["day_of", "one_hour"],
    );
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});


test("planner card reminders deduplicate repeats and send again when the event date changes", async () => {
  const ownerId = `planner-card-dedupe-test-${randomUUID()}`;
  const shareIds: string[] = [];
  const sentTags: string[] = [];
  const dependencies = {
    sendPushNotificationToUser: async (_sentOwnerId: string, payload: { tag?: string }) => {
      sentTags.push(payload.tag ?? "");
      return { configured: true, sent: 1, removed: 0 };
    },
  };

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    const firstReminderTime = new Date("2026-09-27T13:50:00.000Z");
    await runPlannerNotificationJob(firstReminderTime, dependencies);
    await runPlannerNotificationJob(firstReminderTime, dependencies);
    assert.equal(sentTags.length, 1);

    await db.update(scheduleSharesTable).set({
      events: [cardEvent({ date: "2026-09-28" })],
    }).where(eq(scheduleSharesTable.id, shareId));
    await runPlannerNotificationJob(new Date("2026-09-28T13:50:00.000Z"), dependencies);

    assert.equal(sentTags.length, 2);
    assert.match(sentTags[0] ?? "", /one_hour-2026-09-27$/);
    assert.match(sentTags[1] ?? "", /one_hour-2026-09-28$/);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.deepEqual(
      deliveries.map((delivery) => delivery.eventDate).sort(),
      ["2026-09-27", "2026-09-28"],
    );
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("deleted Game On Cards do not produce future planner reminders", async () => {
  const ownerId = `planner-card-delete-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let pushCount = 0;

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    const dependencies = {
      sendPushNotificationToUser: async () => {
        pushCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    };
    const reminderTime = new Date("2026-09-27T13:50:00.000Z");
    await runPlannerNotificationJob(reminderTime, dependencies);
    assert.equal(pushCount, 1);

    await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, shareId));
    shareIds.splice(shareIds.indexOf(shareId), 1);
    await runPlannerNotificationJob(reminderTime, dependencies);
    assert.equal(pushCount, 1);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("planner ignores legacy Calendar events and skips final Game On Cards", async () => {
  const ownerId = `planner-card-skip-test-${randomUUID()}`;
  const shareIds: string[] = [];
  const projectIds: string[] = [];
  const sentTitles: string[] = [];

  try {
    await addPlannerSubscription(ownerId);
    shareIds.push(await insertGameOnCard(ownerId, [cardEvent({ status: "final" })]));
    const duplicateEvent = cardEvent({ id: "same-game" });
    const duplicateCardId = await insertGameOnCard(ownerId, [duplicateEvent]);
    shareIds.push(duplicateCardId);
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Calendar duplicate test",
      project: {
        tool: "schedule",
        teamName: "Test Team",
        season: "2026",
        events: [duplicateEvent],
      },
    }).returning({ id: cloudProjectsTable.id });
    projectIds.push(project.id);

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      sendPushNotificationToUser: async (_sentOwnerId, payload) => {
        sentTitles.push(payload.title);
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.deepEqual(sentTitles, ["GAME DAY · IN 1 HOUR"]);
    const deliveriesByCard = await Promise.all(shareIds.map((shareId) => (
      db.select()
        .from(plannerCardNotificationDeliveriesTable)
        .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId))
    )));
    assert.equal(deliveriesByCard.reduce((sum, deliveries) => sum + deliveries.length, 0), 1);
    const projectDeliveries = await db.select()
      .from(plannerNotificationDeliveriesTable)
      .where(eq(plannerNotificationDeliveriesTable.projectId, project.id));
    assert.equal(projectDeliveries.length, 0);
  } finally {
    await cleanCardFixture(ownerId, shareIds, projectIds);
  }
});

test("planner skips a Game On Card whose tracker game is finalized", async () => {
  const ownerId = `planner-card-final-tracker-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;
  const event = cardEvent({ id: "tracker-finalized-game" });

  try {
    await addPlannerSubscription(ownerId);
    shareIds.push(await insertGameOnCard(ownerId, [event]));
    await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: event.id,
      athleteName: "Test Athlete",
      teamName: "Test Team",
      game: { status: "final", opponent: event.opponent },
      expiresAt: new Date("2026-09-28T13:50:00.000Z"),
    });

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.equal(sendCount, 0);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareIds[0]!));
    assert.equal(deliveries.length, 0);
  } finally {
    await db.delete(statTrackerSharesTable)
      .where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("Game On Card display receipts require the matching push subscription", async () => {
  const ownerId = `planner-card-receipt-test-${randomUUID()}`;
  const endpoint = `https://push.example.test/${randomUUID()}`;
  const shareIds: string[] = [];
  let deliveryId: string | undefined;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", webPushRouter);
  const server = app.listen(0);

  try {
    await db.insert(webPushSubscriptionsTable).values({
      ownerClerkUserId: ownerId,
      endpoint,
      p256dh: "receipt-test-p256dh",
      auth: "receipt-test-auth",
      timezone: "UTC",
    });
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    const [delivery] = await db.insert(plannerCardNotificationDeliveriesTable).values({
      shareId,
      eventId: "game-on-card-event",
      notificationType: "one_hour",
      eventDate: "2026-09-27",
    }).returning({ id: plannerCardNotificationDeliveriesTable.id });
    deliveryId = delivery.id;

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const receiptUrl = `http://127.0.0.1:${address.port}/api/notifications/deliveries/${deliveryId}/displayed`;
    const rejected = await fetch(receiptUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscriptionEndpoint: `https://push.example.test/${randomUUID()}` }),
    });
    assert.equal(rejected.status, 404);

    const accepted = await fetch(receiptUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscriptionEndpoint: endpoint }),
    });
    assert.equal(accepted.status, 204);

    const [updatedDelivery] = await db.select({
      displayedAt: plannerCardNotificationDeliveriesTable.displayedAt,
    }).from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.id, deliveryId));
    assert.ok(updatedDelivery?.displayedAt instanceof Date);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (deliveryId) {
      await db.delete(plannerCardNotificationDeliveriesTable)
        .where(eq(plannerCardNotificationDeliveriesTable.id, deliveryId));
    }
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("concurrent planner runs send a Game On Card reminder only once", async () => {
  const ownerId = `planner-card-concurrent-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;
  let signalSenderStarted!: () => void;
  let releaseSender!: () => void;
  const senderStarted = new Promise<void>((resolve) => {
    signalSenderStarted = resolve;
  });
  const senderRelease = new Promise<{ configured: boolean; sent: number; removed: number }>((resolve) => {
    releaseSender = () => resolve({ configured: true, sent: 1, removed: 0 });
  });

  try {
    await addPlannerSubscription(ownerId);
    shareIds.push(await insertGameOnCard(ownerId));
    const dependencies = {
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        signalSenderStarted();
        return senderRelease;
      },
    };
    const now = new Date("2026-09-27T13:50:00.000Z");
    const firstRun = runPlannerNotificationJob(now, dependencies);
    await senderStarted;
    await runPlannerNotificationJob(now, dependencies);
    assert.equal(sendCount, 1);
    releaseSender();
    await firstRun;

    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareIds[0]!));
    assert.equal(deliveries.length, 1);
    assert.ok(deliveries[0]?.sentAt instanceof Date);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("a delayed run catches due cards across customers without repeating them", async () => {
  const utcOwner = `planner-worker-utc-${randomUUID()}`;
  const easternOwner = `planner-worker-eastern-${randomUUID()}`;
  const futureOwner = `planner-worker-future-${randomUUID()}`;
  const fixtures: Array<{ ownerId: string; shareId: string }> = [];
  const sentOwners: string[] = [];

  try {
    await addPlannerSubscription(utcOwner, "UTC");
    await addPlannerSubscription(easternOwner, "America/New_York");
    await addPlannerSubscription(futureOwner, "UTC");
    fixtures.push({
      ownerId: utcOwner,
      shareId: await insertGameOnCard(utcOwner, [cardEvent({ date: "2026-09-27", time: "14:50" })]),
    });
    fixtures.push({
      ownerId: easternOwner,
      shareId: await insertGameOnCard(easternOwner, [cardEvent({ date: "2026-09-27", time: "10:50 AM" })]),
    });
    fixtures.push({
      ownerId: futureOwner,
      shareId: await insertGameOnCard(futureOwner, [cardEvent({ date: "2026-09-27", time: "17:50" })]),
    });

    const dependencies = {
      sendPushNotificationToUser: async (ownerId: string) => {
        sentOwners.push(ownerId);
        return { configured: true, sent: 1, removed: 0 };
      },
    };
    // Both target times were 13:50Z; a worker delayed eight minutes must
    // still find both owners' due cards and only deliver once on the next run.
    await runPlannerNotificationJob(new Date("2026-09-27T13:58:00.000Z"), dependencies);
    await runPlannerNotificationJob(new Date("2026-09-27T14:00:00.000Z"), dependencies);

    assert.deepEqual(sentOwners.sort(), [easternOwner, utcOwner].sort());
    for (const { ownerId, shareId } of fixtures) {
      const rows = await db.select().from(plannerCardNotificationDeliveriesTable)
        .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
      assert.equal(rows.length, ownerId === futureOwner ? 0 : 1);
    }
  } finally {
    for (const { ownerId, shareId } of fixtures) {
      await cleanCardFixture(ownerId, [shareId]);
    }
  }
});

test("one customer's failed push does not prevent other due customers, and retries only the failure", async () => {
  const firstOwner = `planner-customer-failure-a-${randomUUID()}`;
  const secondOwner = `planner-customer-failure-b-${randomUUID()}`;
  const fixtures: Array<{ ownerId: string; shareId: string }> = [];
  const sent: string[] = [];
  let failFirst = true;
  try {
    for (const ownerId of [firstOwner, secondOwner]) {
      await addPlannerSubscription(ownerId, "UTC");
      fixtures.push({ ownerId, shareId: await insertGameOnCard(ownerId) });
    }
    const dependencies = {
      sendPushNotificationToUser: async (ownerId: string) => {
        if (ownerId === firstOwner && failFirst) throw new Error("temporary push failure");
        sent.push(ownerId);
        return { configured: true, sent: 1, removed: 0 };
      },
    };
    const now = new Date("2026-09-27T13:50:00.000Z");
    await assert.rejects(runPlannerNotificationJob(now, dependencies), /Game On reminders failed/);
    assert.deepEqual(sent, [secondOwner]);
    failFirst = false;
    await runPlannerNotificationJob(new Date("2026-09-27T13:52:00.000Z"), dependencies);
    assert.deepEqual(sent, [secondOwner, firstOwner]);
  } finally {
    for (const { ownerId, shareId } of fixtures) {
      await cleanCardFixture(ownerId, [shareId]);
    }
  }
});

test("a run delayed past game start sends one capture-open catch-up, not an old one-hour alert", async () => {
  const ownerId = `planner-worker-catchup-${randomUUID()}`;
  const shareIds: string[] = [];
  const sentTitles: string[] = [];
  try {
    await addPlannerSubscription(ownerId, "UTC");
    const shareId = await insertGameOnCard(ownerId, [cardEvent({ time: "14:50" })]);
    shareIds.push(shareId);
    const dependencies = {
      sendPushNotificationToUser: async (_owner: string, payload: { title: string }) => {
        sentTitles.push(payload.title);
        return { configured: true, sent: 1, removed: 0 };
      },
    };
    await runPlannerNotificationJob(new Date("2026-09-27T15:08:00.000Z"), dependencies);
    await runPlannerNotificationJob(new Date("2026-09-27T15:10:00.000Z"), dependencies);
    assert.deepEqual(sentTitles, ["GAME DAY · CAPTURE OPEN"]);
    const rows = await db.select().from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.deepEqual(rows.map((row) => row.notificationType), ["capture_open"]);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("an acknowledged pending alert is never resent by a later worker", async () => {
  const ownerId = `planner-displayed-retry-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    const displayedAt = new Date(Date.now() - 3 * 60 * 1000);
    await db.insert(plannerCardNotificationDeliveriesTable).values({
      shareId,
      eventId: "game-on-card-event",
      notificationType: "one_hour",
      eventDate: "2026-09-27",
      createdAt: displayedAt,
      displayedAt,
    });

    await runPlannerNotificationJob(new Date("2026-09-27T13:58:00.000Z"), {
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    });
    assert.equal(sendCount, 0);
    const [delivery] = await db.select().from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(delivery?.sentAt?.getTime(), displayedAt.getTime());
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("zero-send card attempts release their pending claim for a successful retry", async () => {
  const ownerId = `planner-card-retry-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    const dependencies = {
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: sendCount === 1 ? 0 : 1, removed: 0 };
      },
    };
    const now = new Date("2026-09-27T13:50:00.000Z");
    await runPlannerNotificationJob(now, dependencies);
    const afterZeroSend = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(afterZeroSend.length, 0);

    await runPlannerNotificationJob(now, dependencies);
    const afterRetry = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(sendCount, 2);
    assert.equal(afterRetry.length, 1);
    assert.ok(afterRetry[0]?.sentAt instanceof Date);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("stale pending card claims can be reclaimed and sent", async () => {
  const ownerId = `planner-card-stale-claim-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    const staleCreatedAt = new Date(Date.now() - 3 * 60 * 1000);
    const [pendingClaim] = await db.insert(plannerCardNotificationDeliveriesTable).values({
      shareId,
      eventId: "game-on-card-event",
      notificationType: "one_hour",
      eventDate: "2026-09-27",
      createdAt: staleCreatedAt,
    }).returning({ id: plannerCardNotificationDeliveriesTable.id });

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(sendCount, 1);
    assert.equal(deliveries.length, 1);
    assert.notEqual(deliveries[0]?.id, pendingClaim.id);
    assert.ok(deliveries[0]?.sentAt instanceof Date);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("heartbeat renews an aged in-flight claim before an overlapping planner run", async () => {
  const ownerId = `planner-card-heartbeat-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;
  let signalSenderStarted!: () => void;
  let releaseSender!: () => void;
  let firstRun: Promise<void> | undefined;
  const senderStarted = new Promise<void>((resolve) => {
    signalSenderStarted = resolve;
  });
  const senderRelease = new Promise<{ configured: boolean; sent: number; removed: number }>((resolve) => {
    releaseSender = () => resolve({ configured: true, sent: 1, removed: 0 });
  });

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId);
    shareIds.push(shareId);
    const dependencies = {
      pendingDeliveryHeartbeatMs: 20,
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        signalSenderStarted();
        return senderRelease;
      },
    };
    const now = new Date("2026-09-27T13:50:00.000Z");
    firstRun = runPlannerNotificationJob(now, dependencies);
    await senderStarted;

    const staleCreatedAt = new Date(Date.now() - 3 * 60 * 1000);
    await db.update(plannerCardNotificationDeliveriesTable)
      .set({ createdAt: staleCreatedAt })
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));

    let renewedCreatedAt: Date | undefined;
    const renewalDeadline = Date.now() + 1_000;
    while (Date.now() < renewalDeadline) {
      const [claim] = await db.select({
        createdAt: plannerCardNotificationDeliveriesTable.createdAt,
      }).from(plannerCardNotificationDeliveriesTable)
        .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
      if (claim && claim.createdAt > staleCreatedAt) {
        renewedCreatedAt = claim.createdAt;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(renewedCreatedAt && renewedCreatedAt > staleCreatedAt);

    await runPlannerNotificationJob(now, dependencies);
    assert.equal(sendCount, 1);
    releaseSender();
    await firstRun;

    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(deliveries.length, 1);
    assert.ok(deliveries[0]?.sentAt instanceof Date);
  } finally {
    releaseSender();
    await firstRun?.catch(() => undefined);
    await cleanCardFixture(ownerId, shareIds);
  }
});

test("final practice Game On Cards do not alert", async () => {
  const ownerId = `planner-card-final-practice-test-${randomUUID()}`;
  const shareIds: string[] = [];
  let sendCount = 0;

  try {
    await addPlannerSubscription(ownerId);
    const shareId = await insertGameOnCard(ownerId, [
      cardEvent({ type: "practice", status: "final" }),
    ]);
    shareIds.push(shareId);

    await runPlannerNotificationJob(new Date("2026-09-27T13:50:00.000Z"), {
      sendPushNotificationToUser: async () => {
        sendCount += 1;
        return { configured: true, sent: 1, removed: 0 };
      },
    });

    assert.equal(sendCount, 0);
    const deliveries = await db.select()
      .from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, shareId));
    assert.equal(deliveries.length, 0);
  } finally {
    await cleanCardFixture(ownerId, shareIds);
  }
});