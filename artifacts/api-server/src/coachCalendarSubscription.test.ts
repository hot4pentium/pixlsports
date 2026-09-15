import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  coachCalendarCodesTable,
  db,
  scheduleSharesTable,
} from "@workspace/db";
import { buildCoachCalendarIcs } from "./lib/coachCalendarIcs";
import coachCalendarRouter, {
  createCoachCalendarSubscriptionForOwner,
  findActiveCoachCalendarSubscription,
  revokeCoachCalendarSubscriptionForOwner,
} from "./routes/coachCalendar";

const baseEvent = {
  id: "event-stable-id",
  type: "game" as const,
  date: "2026-10-03",
  time: "09:30",
  location: "Field 1, North; Gate A",
  opponent: "Comets, United",
  snacks: "Avery; Sam",
  drinks: "Water",
  notes: "Bring white jerseys\nArrive early",
};

test("ICS output escapes text, folds long lines, and ignores malformed dates", () => {
  const ics = buildCoachCalendarIcs("private-owner-id", {
    title: "Falcons, U12",
    teamSeason: "Fall; 2026",
    events: [
      baseEvent,
      { ...baseEvent, id: "bad-date", date: "2026-02-31" },
      { ...baseEvent, id: "all-day", date: "2026-10-04", time: "not-a-time", notes: "x".repeat(120) },
    ],
    updatedAt: new Date("2026-09-14T15:00:00.000Z"),
  });

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /X-WR-CALNAME:Falcons\\, U12 — Fall\\; 2026/);
  assert.match(ics, /SUMMARY:Game vs Comets\\, United/);
  assert.match(ics, /LOCATION:Field 1\\, North\\; Gate A/);
  assert.match(ics, /Bring white jerseys\\nArrive early/);
  assert.match(ics, /DTSTART:20261003T093000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261004/);
  assert.doesNotMatch(ics, /bad-date/);
  assert.ok(ics.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("event UIDs stay stable when schedule details change", () => {
  const first = buildCoachCalendarIcs("private-owner-id", {
    title: "Falcons",
    teamSeason: "Fall",
    events: [baseEvent],
    updatedAt: new Date("2026-09-14T15:00:00.000Z"),
  });
  const changed = buildCoachCalendarIcs("private-owner-id", {
    title: "Falcons",
    teamSeason: "Fall",
    events: [{ ...baseEvent, opponent: "Rockets", location: "Field 2" }],
    updatedAt: new Date("2026-09-15T15:00:00.000Z"),
  });
  const uid = first.match(/\r\nUID:([^\r\n]+)/)?.[1];

  assert.ok(uid);
  assert.match(changed, new RegExp(`\\r\\nUID:${uid}\\r\\n`));
  assert.match(changed, /SUMMARY:Game vs Rockets/);
  assert.match(changed, /LOCATION:Field 2/);
  assert.notEqual(first, changed);
  assert.doesNotMatch(first, /private-owner-id/);
});

test("subscription rotation and revocation are isolated by owner", async () => {
  const ownerA = `calendar-subscription-a-${randomUUID()}`;
  const ownerB = `calendar-subscription-b-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerA, role: "coach", accessMode: "full" },
      { ownerClerkUserId: ownerB, role: "coach", accessMode: "full" },
    ]);
    await db.insert(coachCalendarCodesTable).values([
      { ownerClerkUserId: ownerA, code: "A2BCD" },
      { ownerClerkUserId: ownerB, code: "B2CDE" },
    ]);

    const firstA = await createCoachCalendarSubscriptionForOwner(ownerA);
    const firstB = await createCoachCalendarSubscriptionForOwner(ownerB);
    assert.equal((await findActiveCoachCalendarSubscription(firstA.token))?.ownerClerkUserId, ownerA);
    assert.equal((await findActiveCoachCalendarSubscription(firstB.token))?.ownerClerkUserId, ownerB);

    const refreshedA = await createCoachCalendarSubscriptionForOwner(ownerA);
    assert.notEqual(refreshedA.token, firstA.token);
    assert.equal(await findActiveCoachCalendarSubscription(firstA.token), null);
    assert.equal((await findActiveCoachCalendarSubscription(refreshedA.token))?.ownerClerkUserId, ownerA);
    assert.equal((await findActiveCoachCalendarSubscription(firstB.token))?.ownerClerkUserId, ownerB);

    await revokeCoachCalendarSubscriptionForOwner(ownerA);
    assert.equal(await findActiveCoachCalendarSubscription(refreshedA.token), null);
    assert.equal((await findActiveCoachCalendarSubscription(firstB.token))?.ownerClerkUserId, ownerB);
  } finally {
    await db.delete(coachCalendarCodesTable).where(eq(coachCalendarCodesTable.ownerClerkUserId, ownerA));
    await db.delete(coachCalendarCodesTable).where(eq(coachCalendarCodesTable.ownerClerkUserId, ownerB));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerA));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerB));
  }
});

test("anonymous feed serves current schedule as calendar content", async () => {
  const ownerClerkUserId = `calendar-feed-${randomUUID()}`;
  const app = express();
  app.use("/api", coachCalendarRouter);
  const server = app.listen(0);

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "coach",
      accessMode: "full",
    });
    await db.insert(coachCalendarCodesTable).values({
      ownerClerkUserId,
      code: "C2DEF",
    });
    const [schedule] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId,
      title: "Eastside Falcons",
      teamSeason: "Fall 2026",
      events: [baseEvent],
    }).returning();
    const subscription = await createCoachCalendarSubscriptionForOwner(ownerClerkUserId);
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}${subscription.feedPath}`;

    const firstResponse = await fetch(url);
    const firstBody = await firstResponse.text();
    assert.equal(firstResponse.status, 200);
    assert.match(firstResponse.headers.get("content-type") ?? "", /^text\/calendar; charset=utf-8/);
    assert.equal(firstResponse.headers.get("cache-control"), "private, max-age=0, must-revalidate");
    assert.match(firstBody, /X-WR-CALNAME:Eastside Falcons — Fall 2026/);
    assert.match(firstBody, /SUMMARY:Game vs Comets\\, United/);
    const firstUid = firstBody.match(/\r\nUID:([^\r\n]+)/)?.[1];
    assert.ok(firstUid);

    await db
      .update(scheduleSharesTable)
      .set({
        events: [{ ...baseEvent, opponent: "Rockets", notes: "Updated lineup" }],
        updatedAt: new Date("2026-09-15T16:00:00.000Z"),
      })
      .where(eq(scheduleSharesTable.id, schedule.id));

    const updatedResponse = await fetch(url);
    const updatedBody = await updatedResponse.text();
    assert.equal(updatedResponse.status, 200);
    assert.match(updatedBody, /SUMMARY:Game vs Rockets/);
    assert.match(updatedBody, /Updated lineup/);
    assert.match(updatedBody, new RegExp(`\\r\\nUID:${firstUid}\\r\\n`));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.ownerClerkUserId, ownerClerkUserId));
    await db.delete(coachCalendarCodesTable).where(eq(coachCalendarCodesTable.ownerClerkUserId, ownerClerkUserId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
  }
});