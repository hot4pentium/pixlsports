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

test("a repeated event delivers once per athlete and does not consume another athlete's delivery", async () => {
  const first = await createFixture();
  const second = await createFixture();
  const eventKey = `shared-event-${randomUUID()}`;
  const sentTo: string[] = [];
  const send = async (subscription: (typeof first.followers)[number]) => {
    sentTo.push(subscription.inviteId);
    return { configured: true, sent: true, stale: false };
  };
  try {
    // The same browser endpoint may be attached to separate athlete invites.
    await db.update(athleteInviteFansTable)
      .set({ endpoint: first.followers[0]!.endpoint })
      .where(eq(athleteInviteFansTable.id, second.followers[0]!.id));
    await db.update(athleteInviteFansTable)
      .set({ eventAlerts: false })
      .where(eq(athleteInviteFansTable.id, second.followers[1]!.id));
    assert.equal((await notifyAthleteInviteFans(first.invite.id, eventKey, "event", { send })).sent, 2);
    assert.equal((await notifyAthleteInviteFans(first.invite.id, eventKey, "event", { send })).sent, 0);
    assert.equal((await notifyAthleteInviteFans(second.invite.id, eventKey, "event", { send })).sent, 1);
    assert.equal((await notifyAthleteInviteFans(second.invite.id, eventKey, "event", { send })).sent, 0);
    assert.deepEqual(sentTo, [first.invite.id, first.invite.id, second.invite.id]);
  } finally {
    await cleanFixture(second);
    await cleanFixture(first);
  }
});

test("stopped live sessions and paused cards cannot send new alerts", async () => {
  const fixture = await createFixture();
  let sends = 0;
  const send = async () => {
    sends += 1;
    return { configured: true, sent: true, stale: false };
  };
  try {
    await db.update(athleteInvitesTable)
      .set({ liveTrackerShareToken: null })
      .where(eq(athleteInvitesTable.id, fixture.invite.id));
    assert.equal((await notifyAthleteInviteFans(fixture.invite.id, fixture.gameId, "live", {
      liveShareId: fixture.share.id, send,
    })).sent, 0);
    await db.update(athleteInvitesTable)
      .set({ paused: true, liveTrackerShareToken: fixture.share.id })
      .where(eq(athleteInvitesTable.id, fixture.invite.id));
    assert.equal((await notifyAthleteInviteFans(fixture.invite.id, `event-${randomUUID()}`, "event", { send })).sent, 0);
    assert.equal(sends, 0);
  } finally {
    await cleanFixture(fixture);
  }
});