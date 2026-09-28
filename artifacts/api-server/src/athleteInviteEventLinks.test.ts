import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountAccessTable,
  athleteInviteFanDeliveriesTable,
  athleteInviteEventDeliveryClaimsTable,
  athleteInviteEventLinksTable,
  athleteInviteFansTable,
  athleteInvitesTable,
  db,
  scheduleSharesTable,
  statTrackerSharesTable,
} from "@workspace/db";
import athleteInvitesRouter from "./routes/athleteInvites";
import { notifyAthleteInviteFans } from "./lib/athleteInviteFanNotifications";
import { GAME_ON_CARD_MARKER } from "./routes/scheduleShares";
import { getAthleteInviteEventNotificationProgress, notifyAthleteInviteEventFollowers } from "./lib/athleteInviteEventNotifications";

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function beforeDeadline<T>(operation: Promise<T>, message: string, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("HYPE Card event visibility is all-or-none, includes future Game On Cards, and keeps manual delivery durable", async () => {
  const ownerId = `athlete-event-owner-${randomUUID()}`;
  const otherOwnerId = `athlete-event-other-${randomUUID()}`;
  const inviteToken = randomBytes(24).toString("base64url");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", athleteInvitesRouter);
  const server = app.listen(0);
  let inviteId: string | undefined;
  let shareIds: string[] = [];
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: otherOwnerId,
      role: "fan",
      accessMode: "full",
    });
    const [invite] = await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: inviteToken,
      athleteName: "Alex",
      teamName: "North",
      seasonName: "2026",
      seasonEndsAt: new Date(Date.now() + 90 * 86_400_000),
      sport: "basketball",
      timezone: "UTC",
      paused: false,
    }).returning();
    inviteId = invite!.id;
    const [upcoming, finalByTracker, unmarked, foreign] = await db.insert(scheduleSharesTable).values([
      {
        ownerClerkUserId: ownerId,
        title: "Away game",
        teamSeason: GAME_ON_CARD_MARKER,
        events: [{ id: `event-${randomUUID()}`, type: "game", status: "upcoming", date: futureDate(30), time: "18:00", location: "North Gym", opponent: "Owls" }],
      },
      {
        ownerClerkUserId: ownerId,
        title: "Tracked final",
        teamSeason: GAME_ON_CARD_MARKER,
        events: [{ id: `event-${randomUUID()}`, type: "game", status: "upcoming", date: futureDate(31), time: "18:00", location: "South Gym", opponent: "Wolves" }],
      },
      {
        ownerClerkUserId: ownerId,
        title: "Legacy Calendar",
        teamSeason: "Old season",
        events: [{ id: `event-${randomUUID()}`, type: "game", status: "upcoming", date: futureDate(32), time: "18:00", location: "Private gym", opponent: "Hidden" }],
      },
      {
        ownerClerkUserId: otherOwnerId,
        title: "Another owner's card",
        teamSeason: GAME_ON_CARD_MARKER,
        events: [{ id: `event-${randomUUID()}`, type: "game", status: "upcoming", date: futureDate(33), time: "18:00", location: "Private", opponent: "Private" }],
      },
    ]).returning();
    shareIds = [upcoming!.id, finalByTracker!.id, unmarked!.id, foreign!.id];
    await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: (finalByTracker!.events as Array<{ id: string }>)[0]!.id,
      athleteName: "Alex",
      teamName: "North",
      game: { status: "final" },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/athlete-invites/${inviteToken}`;
    const headers = { "x-test-user": ownerId, "content-type": "application/json" };
    const setShowEvents = (showEvents: boolean) => fetch(baseUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        athleteName: "Alex",
        teamName: "North",
        seasonName: "2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        timezone: "UTC",
        trackerProjectId: null,
        scheduleProjectId: null,
        showHypeCard: true,
        showStats: true,
        showSchedule: false,
        showEvents,
        hypesEnabled: true,
        paused: false,
      }),
    });

    const publicFan = await fetch(`${baseUrl}/fan`);
    assert.equal(publicFan.status, 200);
    const publicFanBody = await publicFan.json() as { showEvents: boolean; events: Array<Record<string, unknown>>; timezone: string | null };
    const publicEvents = publicFanBody.events;
    assert.equal(publicFanBody.timezone, "UTC");
    assert.equal(publicFanBody.showEvents, false);
    assert.equal(publicEvents.length, 0);

    const hiddenOwned = await fetch(`http://127.0.0.1:${address.port}/api/athlete-invites`, { headers });
    const hiddenOwnedBody = await hiddenOwned.json() as Array<{ showEvents: boolean; events: unknown[] }>;
    assert.equal(hiddenOwnedBody[0]?.showEvents, false);
    assert.equal(hiddenOwnedBody[0]?.events.length, 0);

    const enabled = await setShowEvents(true);
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json() as { showEvents: boolean }).showEvents, true);
    const enabledFan = await fetch(`${baseUrl}/fan`);
    const enabledFanBody = await enabledFan.json() as { showEvents: boolean; events: Array<Record<string, unknown>> };
    const visibleEvents = enabledFanBody.events;
    assert.equal(enabledFanBody.showEvents, true);
    assert.equal(visibleEvents.length, 2);
    const upcomingPublic = visibleEvents.find((event) => event.shareToken === upcoming!.id);
    const finalPublic = visibleEvents.find((event) => event.shareToken === finalByTracker!.id);
    assert.equal(upcomingPublic?.eventId, (upcoming!.events as Array<{ id: string }>)[0]!.id);
    assert.equal(upcomingPublic?.date, futureDate(30));
    assert.equal(upcomingPublic?.status, "upcoming");
    assert.equal(upcomingPublic?.title, "Away game");
    assert.equal(upcomingPublic?.opponent, "Owls");
    assert.equal(upcomingPublic?.location, "North Gym");
    assert.equal(finalPublic?.status, "final");

    const owned = await fetch(`http://127.0.0.1:${address.port}/api/athlete-invites`, { headers });
    assert.equal((await owned.json() as Array<{ events: unknown[] }>)[0]?.events.length, 2);

    const endpoints = [true, false].map((_, index) => `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}-${index}`);
    const originalFollowers = await db.insert(athleteInviteFansTable).values(endpoints.map((endpoint, index) => ({
      inviteId: invite!.id,
      endpoint,
      p256dh: "test-key",
      auth: "test-auth",
      followTokenHash: randomUUID().replaceAll("-", ""),
      liveAlerts: false,
      eventAlerts: index === 0,
      preEventAlerts: index === 1,
    }))).returning();
    const manualRecipients: string[] = [];
    const send = async (subscription: { endpoint: string; p256dh: string; auth: string }) => {
      manualRecipients.push(subscription.endpoint);
      return { configured: true, sent: true, stale: false };
    };
    const sendResults = await Promise.all([
      notifyAthleteInviteEventFollowers(inviteToken, ownerId, upcoming!.id, { send }),
      notifyAthleteInviteEventFollowers(inviteToken, ownerId, upcoming!.id, { send }),
    ]);
    assert.deepEqual(manualRecipients, [endpoints[1]]);
    assert.equal(sendResults.every((result) => result.status === "ok"), true);
    const priorResult = await notifyAthleteInviteEventFollowers(inviteToken, ownerId, upcoming!.id, { send });
    assert.deepEqual(priorResult, { status: "ok", eligible: 1, sent: 1, failed: 0, pending: 0, remaining: 0 });
    assert.deepEqual(manualRecipients, [endpoints[1]]);

    const scheduledRecipients: string[] = [];
    const scheduledResult = await notifyAthleteInviteFans(
      invite!.id,
      "legacy-event-start",
      "event",
      {
        send: async (subscription) => {
          scheduledRecipients.push(subscription.endpoint);
          return { configured: true, sent: false, stale: false };
        },
      },
    );
    assert.deepEqual(scheduledRecipients, [endpoints[0]]);
    assert.equal(scheduledResult.sent, 0);
    const storedFollows = await db.select({
      endpoint: athleteInviteFansTable.endpoint,
      eventAlerts: athleteInviteFansTable.eventAlerts,
      preEventAlerts: athleteInviteFansTable.preEventAlerts,
    }).from(athleteInviteFansTable).where(eq(athleteInviteFansTable.inviteId, invite!.id));
    assert.deepEqual(storedFollows.map(({ endpoint, eventAlerts, preEventAlerts }) => ({
      endpoint,
      eventAlerts,
      preEventAlerts,
    })), [
      { endpoint: endpoints[0], eventAlerts: true, preEventAlerts: false },
      { endpoint: endpoints[1], eventAlerts: false, preEventAlerts: true },
    ]);

    const [slowShare] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Slow push test",
      teamSeason: GAME_ON_CARD_MARKER,
      events: [{ id: `event-${randomUUID()}`, type: "game", status: "upcoming", date: futureDate(35), time: "18:00" }],
    }).returning();
    shareIds.push(slowShare!.id);
    const extraFollowers = await db.insert(athleteInviteFansTable).values(
      Array.from({ length: 3 }, () => ({
        inviteId: invite!.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`,
        p256dh: "test-key",
        auth: "test-auth",
        followTokenHash: randomUUID().replaceAll("-", ""),
        liveAlerts: false,
        eventAlerts: false,
        preEventAlerts: true,
      })),
    ).returning();
    let releasePush!: () => void;
    const pushGate = new Promise<void>((resolve) => { releasePush = resolve; });
    let allStarted!: () => void;
    const started = new Promise<void>((resolve) => { allStarted = resolve; });
    const startedEndpoints: string[] = [];
    const slowSend = async (subscription: { endpoint: string; p256dh: string; auth: string }) => {
      startedEndpoints.push(subscription.endpoint);
      if (startedEndpoints.length === extraFollowers.length + 1) allStarted();
      await pushGate;
      return { configured: true, sent: true, stale: false };
    };
    const sending = notifyAthleteInviteEventFollowers(inviteToken, ownerId, slowShare!.id, { send: slowSend });
    let slowError: unknown;
    try {
      // All network requests should start while the first is still unresolved.
      await beforeDeadline(started, "Push requests serialized behind an invite lock", 6000);
      // Opting out must commit while the push service is still stalled.
      await beforeDeadline(
        db.update(athleteInviteFansTable).set({ preEventAlerts: false })
          .where(eq(athleteInviteFansTable.id, originalFollowers[1]!.id)),
        "Follower opt-out blocked by a slow push", 3000,
      );
    } catch (error) {
      slowError = error;
    } finally {
      releasePush();
    }
    const slowResult = await sending;
    if (slowError) throw slowError;
    assert.equal(startedEndpoints.length, 4);
    assert.deepEqual(slowResult, { status: "ok", eligible: 3, sent: 3, failed: 0, pending: 0, remaining: 0 });
    const afterSlowSend = await notifyAthleteInviteEventFollowers(inviteToken, ownerId, slowShare!.id, { send: slowSend });
    assert.deepEqual(afterSlowSend, slowResult);
    assert.equal(startedEndpoints.length, 4);

    const [largeShare] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Large slow audience",
      teamSeason: GAME_ON_CARD_MARKER,
      events: [{ id: `event-${randomUUID()}`, type: "game", status: "upcoming", date: futureDate(36), time: "18:00" }],
    }).returning();
    shareIds.push(largeShare!.id);
    const largeFollowers = await db.insert(athleteInviteFansTable).values(Array.from({ length: 29 }, () => ({
      inviteId: invite!.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`,
      p256dh: "test-key",
      auth: "test-auth",
      followTokenHash: randomUUID().replaceAll("-", ""),
      liveAlerts: false,
      eventAlerts: false,
      preEventAlerts: true,
    }))).returning();
    let finishSlow!: () => void;
    const stalled = new Promise<void>((resolve) => { finishSlow = resolve; });
    const attemptedEndpoints: string[] = [];
    const nonDelivering = async (subscription: { endpoint: string; p256dh: string; auth: string }) => {
      attemptedEndpoints.push(subscription.endpoint);
      if (attemptedEndpoints.length <= 8) await stalled;
      return { configured: true, sent: false, stale: false };
    };
    try {
      const first = await beforeDeadline(
        notifyAthleteInviteEventFollowers(inviteToken, ownerId, largeShare!.id, { send: nonDelivering, background: true }),
        "A slow push held the owner request open", 5000,
      );
      assert.equal(first.status, "ok");
      if (first.status !== "ok") throw new Error("Event missing");
      assert.equal(first.pending, 8);
      assert.equal(first.remaining, 24); // 29 new followers plus three still opted in
      const baseLarge = `http://127.0.0.1:${address.port}/api/athlete-invites/${inviteToken}/events/${largeShare!.id}/notify`;
      const reported = await fetch(baseLarge, { headers });
      assert.equal(reported.status, 200);
      assert.equal((await reported.json() as { pending: number }).pending, 8);
      assert.equal((await fetch(baseLarge, { headers: { "x-test-user": otherOwnerId } })).status, 404);
      // Simulate the owner losing the response/process mid-flight. A repeat
      // must continue unclaimed devices, never retry the eight uncertain ones.
      for (let index = 0; index < 3; index++) {
        const next = await notifyAthleteInviteEventFollowers(inviteToken, ownerId, largeShare!.id, { send: nonDelivering });
        assert.equal(next.status, "ok");
      }
      assert.equal(attemptedEndpoints.length, 32);
      assert.equal(new Set(attemptedEndpoints).size, 32);
      const pendingReport = await getAthleteInviteEventNotificationProgress(inviteToken, ownerId, largeShare!.id);
      assert.deepEqual(pendingReport, { status: "ok", eligible: 32, sent: 0, failed: 24, pending: 8, remaining: 0 });
    } finally {
      finishSlow();
    }
    await beforeDeadline((async () => {
      while (true) {
        const report = await getAthleteInviteEventNotificationProgress(inviteToken, ownerId, largeShare!.id);
        if (report.status === "ok" && report.pending === 0) {
          assert.equal(report.failed, 32);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })(), "Stalled attempts never recorded their outcome", 6000);
    assert.equal(attemptedEndpoints.length, 32);
    await db.delete(athleteInviteFansTable).where(inArray(athleteInviteFansTable.id, largeFollowers.map(({ id }) => id)));

    await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, finalByTracker!.id));
    const publicAfterDeletion = await fetch(`${baseUrl}/fan`);
    const remainingEvents = (await publicAfterDeletion.json() as { events: Array<{ shareToken: string }> }).events;
    assert.deepEqual(remainingEvents.map((event) => event.shareToken).sort(), [upcoming!.id, slowShare!.id, largeShare!.id].sort());

    const disabled = await setShowEvents(false);
    assert.equal(disabled.status, 200);
    const hiddenAgain = await fetch(`${baseUrl}/fan`);
    const hiddenAgainBody = await hiddenAgain.json() as { showEvents: boolean; events: unknown[] };
    assert.equal(hiddenAgainBody.showEvents, false);
    assert.equal(hiddenAgainBody.events.length, 0);
    assert.deepEqual(
      await notifyAthleteInviteEventFollowers(inviteToken, ownerId, upcoming!.id, { send }),
      { status: "not-upcoming" },
    );
    assert.equal((await setShowEvents(true)).status, 200);

    await db.update(athleteInvitesTable).set({ timezone: null }).where(eq(athleteInvitesTable.id, invite!.id));
    const legacyTimezoneFan = await fetch(`${baseUrl}/fan`);
    assert.equal((await legacyTimezoneFan.json() as { timezone: string | null }).timezone, null);

    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invite!.id));
    const pausedResult = await notifyAthleteInviteEventFollowers(inviteToken, ownerId, upcoming!.id, { send });
    assert.deepEqual(pausedResult, { status: "not-found" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (inviteId) {
      await db.delete(athleteInviteEventDeliveryClaimsTable).where(eq(athleteInviteEventDeliveryClaimsTable.inviteId, inviteId));
      await db.delete(athleteInviteFanDeliveriesTable).where(eq(athleteInviteFanDeliveriesTable.inviteId, inviteId));
      await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.inviteId, inviteId));
      await db.delete(athleteInviteEventLinksTable).where(eq(athleteInviteEventLinksTable.inviteId, inviteId));
      await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, inviteId));
    }
    if (shareIds.length) await db.delete(scheduleSharesTable).where(and(
      inArray(scheduleSharesTable.id, shareIds),
    ));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherOwnerId));
  }
});