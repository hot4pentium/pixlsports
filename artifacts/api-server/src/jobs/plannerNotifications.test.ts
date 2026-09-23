import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  cloudProjectsTable,
  db,
  plannerNotificationDeliveriesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
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

test("planner job skips invalid dates, sends valid events, and deduplicates repeated runs", async () => {
  const ownerId = `planner-test-${randomUUID()}`;
  const endpoint = `https://push.example.test/${randomUUID()}`;
  const sent: Array<{ ownerId: string; tag?: string; title: string }> = [];
  let projectId: string | undefined;

  try {
    await db.insert(webPushSubscriptionsTable).values({
      ownerClerkUserId: ownerId,
      endpoint,
      p256dh: "test-p256dh",
      auth: "test-auth",
      timezone: "America/New_York",
    });
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Planner notification test",
      project: {
        tool: "schedule",
        teamName: "Test Team",
        season: "2026",
        events: [
          {
            id: "invalid-date",
            type: "game",
            date: "2026-02-30",
            opponent: "Ignored",
          },
          {
            id: "event-1",
            type: "game",
            status: "upcoming",
            date: "2026-03-10",
            time: "13:00",
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
    const oneHourBefore = new Date("2026-03-10T16:00:00.000Z");

    await runPlannerNotificationJob(oneHourBefore, dependencies);
    await runPlannerNotificationJob(oneHourBefore, dependencies);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.ownerId, ownerId);
    assert.equal(sent[0]?.title, "Starting in 1 hour: Game vs Falcons");
    assert.match(sent[0]?.tag ?? "", /event-1-one_hour-2026-03-10/);

    const deliveriesAfterRepeat = await db
      .select()
      .from(plannerNotificationDeliveriesTable)
      .where(eq(plannerNotificationDeliveriesTable.projectId, projectId));
    assert.equal(deliveriesAfterRepeat.length, 1);
    assert.equal(deliveriesAfterRepeat[0]?.eventDate, "2026-03-10");

    await db.update(cloudProjectsTable).set({
      project: {
        tool: "schedule",
        teamName: "Test Team",
        season: "2026",
        events: [
          {
            id: "invalid-date",
            type: "game",
            date: "not-a-date",
            opponent: "Ignored",
          },
          {
            id: "event-1",
            type: "game",
            status: "upcoming",
            date: "2026-03-11",
            time: "13:00",
            location: "Main Gym",
            opponent: "Falcons",
          },
        ],
      },
    }).where(eq(cloudProjectsTable.id, projectId));

    await runPlannerNotificationJob(new Date("2026-03-11T16:00:00.000Z"), dependencies);

    assert.equal(sent.length, 2);
    assert.match(sent[1]?.tag ?? "", /event-1-one_hour-2026-03-11/);
    const deliveriesAfterDateChange = await db
      .select()
      .from(plannerNotificationDeliveriesTable)
      .where(and(
        eq(plannerNotificationDeliveriesTable.projectId, projectId),
        eq(plannerNotificationDeliveriesTable.eventId, "event-1"),
      ));
    assert.deepEqual(
      deliveriesAfterDateChange.map((delivery) => delivery.eventDate).sort(),
      ["2026-03-10", "2026-03-11"],
    );
  } finally {
    if (projectId) {
      await db.delete(plannerNotificationDeliveriesTable)
        .where(eq(plannerNotificationDeliveriesTable.projectId, projectId));
      await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, projectId));
    }
    await db.delete(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerId));
  }
});