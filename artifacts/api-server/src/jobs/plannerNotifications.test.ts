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
  getPlannerReminderForTest,
  runPlannerNotificationJob,
} from "./plannerNotifications";

test("planner reminders use each subscription's local morning and evening cutoffs", () => {
  const cases = [
    {
      timezone: "America/New_York",
      today: "2026-01-15",
      tomorrow: "2026-01-16",
      beforeMorning: "2026-01-15T11:59:00.000Z",
      morning: "2026-01-15T12:00:00.000Z",
      beforeEvening: "2026-01-15T22:59:00.000Z",
      evening: "2026-01-15T23:00:00.000Z",
    },
    {
      timezone: "America/Los_Angeles",
      today: "2026-01-15",
      tomorrow: "2026-01-16",
      beforeMorning: "2026-01-15T14:59:00.000Z",
      morning: "2026-01-15T15:00:00.000Z",
      beforeEvening: "2026-01-16T01:59:00.000Z",
      evening: "2026-01-16T02:00:00.000Z",
    },
  ];

  for (const current of cases) {
    assert.equal(
      getPlannerReminderForTest(current.today, new Date(current.beforeMorning), current.timezone),
      null,
    );
    assert.equal(
      getPlannerReminderForTest(current.today, new Date(current.morning), current.timezone),
      "today",
    );
    assert.equal(
      getPlannerReminderForTest(current.tomorrow, new Date(current.beforeEvening), current.timezone),
      null,
    );
    assert.equal(
      getPlannerReminderForTest(current.tomorrow, new Date(current.evening), current.timezone),
      "tomorrow",
    );
  }
});

test("planner reminders keep morning cutoffs correct across daylight-saving transitions", () => {
  assert.equal(
    getPlannerReminderForTest(
      "2026-03-08",
      new Date("2026-03-08T11:00:00.000Z"),
      "America/New_York",
    ),
    "today",
  );
  assert.equal(
    getPlannerReminderForTest(
      "2026-11-01",
      new Date("2026-11-01T13:00:00.000Z"),
      "America/New_York",
    ),
    "today",
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
            time: "18:00",
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
    const morning = new Date("2026-03-10T11:00:00.000Z");

    await runPlannerNotificationJob(morning, dependencies);
    await runPlannerNotificationJob(morning, dependencies);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.ownerId, ownerId);
    assert.equal(sent[0]?.title, "Today: Game vs Falcons");
    assert.match(sent[0]?.tag ?? "", /event-1-today-2026-03-10/);

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
            time: "18:00",
            location: "Main Gym",
            opponent: "Falcons",
          },
        ],
      },
    }).where(eq(cloudProjectsTable.id, projectId));

    await runPlannerNotificationJob(new Date("2026-03-11T11:00:00.000Z"), dependencies);

    assert.equal(sent.length, 2);
    assert.match(sent[1]?.tag ?? "", /event-1-today-2026-03-11/);
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