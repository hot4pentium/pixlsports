import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  athleteInviteFanDeliveriesTable,
  athleteInvitesTable,
  cloudProjectsTable,
  db,
} from "@workspace/db";
import { getAthleteInviteEventStartForTest, runAthleteInviteFanAlertJob } from "./jobs/athleteInviteFanAlerts";

test("legacy athlete invite event sender is not started by API startup", () => {
  const apiEntry = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(apiEntry, /startAthleteInviteFanAlertSchedule/);
});

test("athlete invite schedule alert time resolves local event start", () => {
  assert.equal(
    getAthleteInviteEventStartForTest("2026-06-01", "7:30 PM", "America/Los_Angeles")?.toISOString(),
    "2026-06-02T02:30:00.000Z",
  );
});

test("athlete invite schedule alert time rejects malformed and impossible dates", () => {
  assert.equal(getAthleteInviteEventStartForTest("2026-02-30", "7:30 PM", "UTC"), null);
  assert.equal(getAthleteInviteEventStartForTest("2026-06-01", "25:30", "UTC"), null);
  assert.equal(getAthleteInviteEventStartForTest("2026-06-01", "7:30 PM", "not-a-zone"), null);
  assert.equal(getAthleteInviteEventStartForTest("2026-06-01", "7:30 PM", null), null);
});

test("legacy invites without an owner timezone skip schedule event alerts", async () => {
  const ownerClerkUserId = `legacy-timezone-${randomUUID()}`;
  const [schedule] = await db.insert(cloudProjectsTable).values({
    ownerClerkUserId,
    name: "Legacy schedule",
    project: {
      tool: "schedule",
      timezone: "UTC",
      events: [{
        id: "nearby-event",
        type: "game",
        status: "upcoming",
        date: new Date(Date.now() - 60_000).toISOString().slice(0, 10),
        time: new Date(Date.now() - 60_000).toISOString().slice(11, 16),
      }],
    },
  }).returning();
  const [invite] = await db.insert(athleteInvitesTable).values({
    ownerClerkUserId,
    publicToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    athleteName: "Legacy Athlete",
    teamName: "Team",
    seasonName: "Season",
    seasonEndsAt: new Date(Date.now() + 86_400_000),
    sport: "basketball",
    timezone: null,
    scheduleProjectId: schedule!.id,
    showHypeCard: false,
    showStats: false,
    showSchedule: true,
    paused: false,
  }).returning();
  try {
    await runAthleteInviteFanAlertJob(new Date());
    assert.deepEqual(await db.select().from(athleteInviteFanDeliveriesTable)
      .where(eq(athleteInviteFanDeliveriesTable.inviteId, invite!.id)), []);
  } finally {
    await db.delete(athleteInviteFanDeliveriesTable)
      .where(eq(athleteInviteFanDeliveriesTable.inviteId, invite!.id));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite!.id));
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, schedule!.id));
  }
});