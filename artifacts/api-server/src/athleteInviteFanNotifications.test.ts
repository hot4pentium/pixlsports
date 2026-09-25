import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  athleteInviteFanDeliveriesTable,
  athleteInviteFansTable,
  athleteInvitesTable,
  db,
  statTrackerSharesTable,
} from "@workspace/db";
import { notifyAthleteInviteFans } from "./lib/athleteInviteFanNotifications";

async function createFixture() {
  const ownerClerkUserId = `fan-alert-race-${randomUUID()}`;
  const gameId = `game-${randomUUID()}`;
  const [share] = await db.insert(statTrackerSharesTable).values({
    ownerClerkUserId,
    gameId,
    athleteName: "Race Athlete",
    teamName: "Team",
    game: { id: gameId, status: "live", score: 1, opponentScore: 0 },
    expiresAt: new Date(Date.now() + 60 * 60_000),
  }).returning();
  const [invite] = await db.insert(athleteInvitesTable).values({
    ownerClerkUserId,
    publicToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    athleteName: "Race Athlete",
    teamName: "Team",
    seasonName: "Season",
    seasonEndsAt: new Date(Date.now() + 86_400_000),
    sport: "basketball",
    timezone: "UTC",
    showHypeCard: true,
    showStats: true,
    showSchedule: true,
    paused: false,
    liveTrackerShareToken: share!.id,
  }).returning();
  await db.insert(athleteInviteFansTable).values([0, 1].map((index) => ({
    inviteId: invite!.id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`,
    p256dh: `p256dh-${index}`,
    auth: `auth-${index}`,
    followTokenHash: randomUUID().replaceAll("-", ""),
    liveAlerts: true,
    eventAlerts: true,
  })));
  const followers = await db.select().from(athleteInviteFansTable)
    .where(eq(athleteInviteFansTable.inviteId, invite!.id));
  return { ownerClerkUserId, gameId, share: share!, invite: invite!, followers };
}

async function cleanFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await db.delete(athleteInviteFanDeliveriesTable)
    .where(eq(athleteInviteFanDeliveriesTable.inviteId, fixture.invite.id));
  await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.inviteId, fixture.invite.id));
  await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, fixture.invite.id));
  await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.id, fixture.share.id));
}

test("live alert rechecks the exact live session after stop and pause-resume races", async () => {
  for (const race of ["stop", "pause-resume"] as const) {
    const fixture = await createFixture();
    let sends = 0;
    try {
      const result = await notifyAthleteInviteFans(fixture.invite.id, fixture.gameId, "live", {
        liveShareId: fixture.share.id,
        send: async () => {
          sends += 1;
          if (sends === 1) {
            await db.update(athleteInvitesTable).set({
              paused: race === "pause-resume",
              liveTrackerShareToken: null,
            }).where(eq(athleteInvitesTable.id, fixture.invite.id));
            await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.id, fixture.share.id));
            if (race === "pause-resume") {
              await db.update(athleteInvitesTable).set({ paused: false })
                .where(eq(athleteInvitesTable.id, fixture.invite.id));
            }
            return { configured: true, sent: true, stale: false };
          }
          return { configured: true, sent: true, stale: false };
        },
      });
      assert.equal(result.sent, 1, race);
      assert.equal(sends, 1, race);
    } finally {
      await cleanFixture(fixture);
    }
  }
});

test("event alerts recheck follows and preferences after the recipient snapshot", async () => {
  for (const race of ["unfollow", "preference-change"] as const) {
    const fixture = await createFixture();
    let sends = 0;
    try {
      const result = await notifyAthleteInviteFans(
        fixture.invite.id,
        `event-${race}-${randomUUID()}`,
        "event",
        {
          send: async (subscription) => {
            sends += 1;
            const others = fixture.followers.filter((follower) => follower.endpoint !== subscription.endpoint);
            for (const other of others) {
              if (race === "unfollow") {
                await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.id, other.id));
              } else {
                await db.update(athleteInviteFansTable).set({ eventAlerts: false })
                  .where(eq(athleteInviteFansTable.id, other.id));
              }
            }
            return { configured: true, sent: true, stale: false };
          },
        },
      );
      assert.equal(result.sent, 1, race);
      assert.equal(sends, 1, race);
    } finally {
      await cleanFixture(fixture);
    }
  }
});