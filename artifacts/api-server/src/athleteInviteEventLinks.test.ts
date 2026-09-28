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
import { notifyAthleteInviteEventFollowers } from "./lib/athleteInviteEventNotifications";

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

test("athlete event links expose only owned marked shares and manual delivery is durable per event and device", async () => {
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
    const emptyLinks = await fetch(`${baseUrl}/event-links`, { headers });
    assert.deepEqual(await emptyLinks.json(), { shareTokens: [] });
    const linked = await fetch(`${baseUrl}/event-links`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ shareTokens: [upcoming!.id, finalByTracker!.id] }),
    });
    assert.equal(linked.status, 200);
    assert.deepEqual((await linked.json() as { shareTokens: string[] }).shareTokens, [upcoming!.id, finalByTracker!.id]);

    const invalidCrossOwner = await fetch(`${baseUrl}/event-links`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ shareTokens: [foreign!.id] }),
    });
    assert.equal(invalidCrossOwner.status, 400);
    assert.equal((await (await fetch(`${baseUrl}/event-links`, { headers })).json() as { shareTokens: string[] }).shareTokens.length, 2);
    const invalidLegacy = await fetch(`${baseUrl}/event-links`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ shareTokens: [unmarked!.id] }),
    });
    assert.equal(invalidLegacy.status, 400);
    assert.equal((await fetch(`${baseUrl}/event-links`, { headers: { "x-test-user": otherOwnerId } })).status, 404);

    const publicFan = await fetch(`${baseUrl}/fan`);
    assert.equal(publicFan.status, 200);
    const publicFanBody = await publicFan.json() as { events: Array<Record<string, unknown>>; timezone: string | null };
    const publicEvents = publicFanBody.events;
    assert.equal(publicFanBody.timezone, "UTC");
    assert.equal(publicEvents.length, 2);
    assert.equal(publicEvents[0]?.shareToken, upcoming!.id);
    assert.equal(publicEvents[0]?.eventId, (upcoming!.events as Array<{ id: string }>)[0]!.id);
    assert.equal(publicEvents[0]?.date, futureDate(30));
    assert.equal(publicEvents[0]?.status, "upcoming");
    assert.equal(publicEvents[0]?.title, "Away game");
    assert.equal(publicEvents[0]?.opponent, "Owls");
    assert.equal(publicEvents[0]?.location, "North Gym");
    assert.equal(publicEvents[1]?.status, "final");

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
    assert.equal(sendResults.reduce((sum, result) => sum + (result.status === "ok" ? result.sent : 0), 0), 1);
    const priorResult = await notifyAthleteInviteEventFollowers(inviteToken, ownerId, upcoming!.id, { send });
    assert.deepEqual(priorResult, { status: "ok", attempted: 0, sent: 0, failed: 0, alreadySent: 1 });
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
    await db.insert(athleteInviteEventLinksTable).values({ inviteId: invite!.id, shareId: slowShare!.id });
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
    assert.deepEqual(slowResult, { status: "ok", attempted: 4, sent: 4, failed: 0, alreadySent: 0 });
    const afterSlowSend = await notifyAthleteInviteEventFollowers(inviteToken, ownerId, slowShare!.id, { send: slowSend });
    assert.deepEqual(afterSlowSend, { status: "ok", attempted: 0, sent: 0, failed: 0, alreadySent: 3 });
    assert.equal(startedEndpoints.length, 4);

    await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, finalByTracker!.id));
    const publicAfterDeletion = await fetch(`${baseUrl}/fan`);
    const remainingEvents = (await publicAfterDeletion.json() as { events: Array<{ shareToken: string }> }).events;
    assert.deepEqual(remainingEvents.map((event) => event.shareToken).sort(), [upcoming!.id, slowShare!.id].sort());

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