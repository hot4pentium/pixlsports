import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  athleteInvitesTable,
  cloudProjectsTable,
  db,
  hypeCardSharesTable,
  statTrackerSharesTable,
} from "@workspace/db";
import {
  GetAthleteInviteResponse,
  StartAthleteInviteLiveResponse,
} from "@workspace/api-zod";

import athleteInvitesRouter from "./routes/athleteInvites";

function dateKey(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

test("athlete invites evolve from owned sources and revoke without exposing private activity", async () => {
  const ownerId = `athlete-invite-${randomUUID()}`;
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

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const [tracker, schedule] = await db.insert(cloudProjectsTable).values([
      {
        ownerClerkUserId: ownerId,
        name: "Season stats",
        project: {
          tool: "stat-tracker",
          games: [
            { id: "final-game", sport: "basketball", status: "final", date: dateKey(-1), opponent: "Comets", score: 42, opponentScore: 40, stats: { points: 18 } },
            { id: "live-game", sport: "basketball", status: "live", date: dateKey(0), opponent: "Stars", score: 8, opponentScore: 7, stats: { points: 6 }, events: [{ private: "live play" }] },
          ],
        },
      },
      {
        ownerClerkUserId: ownerId,
        name: "Fall schedule",
        project: {
          tool: "schedule",
          season: "Fall 2026",
          events: [
            { id: "next", type: "game", status: "upcoming", date: dateKey(2), time: "18:00", location: "Central Gym", opponent: "Falcons", notes: "White jersey", snacks: "Private volunteer" },
            { id: "past", type: "game", status: "final", date: dateKey(-2), time: "18:00", location: "Old Gym", opponent: "Owls", notes: "" },
          ],
        },
      },
    ]).returning();
    const hypeToken = randomBytes(24).toString("base64url");
    const imageToken = randomBytes(24).toString("base64url");
    await db.insert(hypeCardSharesTable).values([
      {
        ownerClerkUserId: ownerId,
        publicToken: hypeToken,
        slug: "latest-hype",
        title: "Game winner",
        manifest: {
          project: {
            headline: "Game winner",
            jerseyNumber: "23",
            position: "Guard",
          },
        },
        shareMode: "card",
        mediaType: "video",
        videoObjectPath: "/test/athlete-invite.mp4",
        videoContentType: "video/mp4",
        videoSize: 1,
        posterObjectPath: "/test/athlete-invite.jpg",
        posterContentType: "image/jpeg",
        posterSize: 1,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
      {
        ownerClerkUserId: ownerId,
        publicToken: imageToken,
        slug: "latest-image",
        title: "Celebration image",
        manifest: { project: { headline: "Celebration image" } },
        shareMode: "card",
        mediaType: "image",
        videoObjectPath: "/test/athlete-invite-image.jpg",
        videoContentType: "image/jpeg",
        videoSize: 1,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    ]);

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const listUrl = `http://127.0.0.1:${address.port}/api/athlete-invites`;
    const create = await fetch(listUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        trackerProjectId: tracker.id,
        scheduleProjectId: schedule.id,
        showHypeCard: true,
        showStats: true,
        showSchedule: true,
      }),
    });
    assert.equal(create.status, 201);
    const owned = await create.json() as { inviteToken: string };
    const publicUrl = `${listUrl}/${owned.inviteToken}`;
    const publicResponse = await fetch(publicUrl);
    assert.equal(publicResponse.status, 200);
    const invite = GetAthleteInviteResponse.parse(await publicResponse.json());
    assert.equal(invite.hypeCard?.shareToken, imageToken);
    assert.equal(invite.hypeCard?.mediaType, "image");
    assert.equal(invite.hypeCard?.posterUrl, `/api/hype-card-shares/${imageToken}/media/video`);
    assert.equal(invite.videos.length, 1);
    assert.equal(invite.videos[0]?.shareToken, hypeToken);
    assert.equal(invite.videos[0]?.title, "Game winner");
    assert.equal(invite.videos[0]?.jerseyNumber, "23");
    assert.equal(invite.videos[0]?.position, "Guard");
    assert.equal(invite.videos[0]?.videoUrl, `/api/hype-card-shares/${hypeToken}/media/video`);
    assert.equal(invite.stats?.gamesPlayed, 1);
    assert.equal(invite.stats?.stats.points, 18);
    assert.equal(invite.stats?.games.some((game) => game.opponent === "Stars"), false);
    assert.equal(invite.scheduleEvents.length, 1);
    assert.equal(invite.scheduleEvents[0]?.opponent, "Falcons");
    assert.equal("snacks" in (invite.scheduleEvents[0] ?? {}), false);

    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    const ownedAfterSourceDeletion = await (await fetch(listUrl, {
      headers: { "x-test-user": ownerId },
    })).json() as Array<{ trackerProjectId: string | null; scheduleProjectId: string | null; inviteToken: string }>;
    assert.equal(ownedAfterSourceDeletion[0]?.trackerProjectId, tracker.id);
    assert.equal(ownedAfterSourceDeletion[0]?.scheduleProjectId, schedule.id);
    assert.equal(ownedAfterSourceDeletion[0]?.inviteToken, owned.inviteToken);
    const publicAfterSourceDeletion = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(publicAfterSourceDeletion.stats, null);
    assert.deepEqual(publicAfterSourceDeletion.scheduleEvents, []);

    const hidden = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        trackerProjectId: null,
        scheduleProjectId: null,
        showHypeCard: false,
        showStats: false,
        showSchedule: false,
      }),
    });
    assert.equal(hidden.status, 200);
    const hiddenPublic = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(hiddenPublic.hypeCard, null);
    assert.deepEqual(hiddenPublic.videos, []);
    assert.equal(hiddenPublic.stats, null);
    assert.deepEqual(hiddenPublic.scheduleEvents, []);

    const paused = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        trackerProjectId: null,
        scheduleProjectId: null,
        showHypeCard: false,
        showStats: false,
        showSchedule: false,
        paused: true,
      }),
    });
    assert.equal(paused.status, 200);
    assert.equal((await fetch(publicUrl)).status, 404);

    const resumed = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        trackerProjectId: null,
        scheduleProjectId: null,
        showHypeCard: false,
        showStats: false,
        showSchedule: false,
        paused: false,
      }),
    });
    assert.equal(resumed.status, 200);
    assert.equal((await fetch(publicUrl)).status, 200);

    assert.equal((await fetch(publicUrl, { method: "DELETE", headers: { "x-test-user": ownerId } })).status, 204);
    assert.equal((await fetch(publicUrl)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, ownerId));
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("athlete pages expose at most ten active videos newest first and ignore image shares", async () => {
  const ownerId = `athlete-videos-${randomUUID()}`;
  const inviteToken = randomBytes(24).toString("base64url");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", athleteInvitesRouter);
  const server = app.listen(0);

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: inviteToken,
      athleteName: "Jordan",
      teamName: "City Hoops",
      seasonName: "Fall 2026",
      seasonEndsAt: new Date(Date.now() + 90 * 86_400_000),
      sport: "basketball",
      trackerProjectId: null,
      scheduleProjectId: null,
      showHypeCard: true,
      showStats: false,
      showSchedule: false,
      paused: false,
    });
    const now = Date.now();
    const imageToken = randomBytes(24).toString("base64url");
    const videoShares = Array.from({ length: 12 }, (_, index) => ({
      ownerClerkUserId: ownerId,
      publicToken: randomBytes(24).toString("base64url"),
      slug: `moment-${index}`,
      title: `Jordan · Fallback ${index}`,
      manifest: {
        project: {
          headline: `Moment ${index}`,
          jerseyNumber: String(20 + index),
          position: index === 11 ? "Point guard" : "Guard",
        },
      },
      shareMode: "card",
      mediaType: "video",
      videoObjectPath: `/test/moment-${index}.mp4`,
      videoContentType: "video/mp4",
      videoSize: 1,
      posterObjectPath: `/test/moment-${index}.jpg`,
      posterContentType: "image/jpeg",
      posterSize: 1,
      expiresAt: new Date(now + 7 * 86_400_000),
      createdAt: new Date(now + index * 1_000),
    }));
    await db.insert(hypeCardSharesTable).values([
      ...videoShares,
      {
        ownerClerkUserId: ownerId,
        publicToken: imageToken,
        slug: "newer-image",
        title: "Newer image",
        manifest: { project: { headline: "Do not include" } },
        shareMode: "card",
        mediaType: "image",
        videoObjectPath: "/test/newer-image.jpg",
        videoContentType: "image/jpeg",
        videoSize: 1,
        posterObjectPath: "/test/newer-image.jpg",
        posterContentType: "image/jpeg",
        posterSize: 1,
        expiresAt: new Date(now + 7 * 86_400_000),
        createdAt: new Date(now + 60_000),
      },
    ]);

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/athlete-invites/${inviteToken}`);
    assert.equal(response.status, 200);
    const invite = GetAthleteInviteResponse.parse(await response.json());
    assert.equal(invite.videos.length, 10);
    assert.equal(invite.videos[0]?.title, "Moment 11");
    assert.equal(invite.videos[0]?.jerseyNumber, "31");
    assert.equal(invite.videos[0]?.position, "Point guard");
    assert.equal(invite.videos.at(-1)?.title, "Moment 2");
    assert.ok(invite.videos.every((video) => video.videoUrl.endsWith("/media/video")));
    assert.ok(invite.videos.every((video) => video.posterUrl?.endsWith("/media/poster")));
    assert.equal(invite.videos.some((video) => video.title === "Do not include"), false);
    assert.equal(invite.hypeCard?.shareToken, imageToken);
    assert.equal(invite.hypeCard?.mediaType, "image");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("Game Day Live follows the Hype Page lifecycle and falls back to finalized stats", async () => {
  const ownerId = `athlete-live-${randomUUID()}`;
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

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const [tracker] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Game Day tracker",
      project: {
        tool: "stat-tracker",
        games: [
          {
            id: "final-game",
            sport: "basketball",
            status: "final",
            date: dateKey(-1),
            opponent: "Comets",
            score: 42,
            opponentScore: 40,
            stats: { points: 18 },
          },
          {
            id: "live-game",
            sport: "basketball",
            status: "live",
            date: dateKey(0),
            opponent: "Stars",
            period: 2,
            score: 8,
            opponentScore: 7,
            stats: { points: 6 },
            privateNotes: "never expose this live snapshot",
            events: [{ private: "live play" }],
          },
        ],
      },
    }).returning();

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const input = {
      athleteName: "Jordan",
      teamName: "City Hoops",
      seasonName: "Fall 2026",
      seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      sport: "basketball",
      trackerProjectId: tracker.id,
      scheduleProjectId: null,
      showHypeCard: false,
      showStats: true,
      showSchedule: false,
      paused: false,
    };
    const create = await fetch(`${baseUrl}/api/athlete-invites`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify(input),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { inviteToken: string };
    const publicUrl = `${baseUrl}/api/athlete-invites/${created.inviteToken}`;
    const liveUrl = `${publicUrl}/live`;

    const started = await fetch(liveUrl, {
      method: "POST",
      headers: { "x-test-user": ownerId },
    });
    assert.equal(started.status, 201);
    const liveSession = StartAthleteInviteLiveResponse.parse(await started.json());
    assert.equal(liveSession.gameId, "live-game");
    assert.ok(liveSession.expiresAt.getTime() > Date.now());

    const livePublicResponse = await fetch(publicUrl);
    assert.equal(livePublicResponse.status, 200);
    const livePublicBody = await livePublicResponse.json() as Record<string, unknown>;
    assert.deepEqual(livePublicBody.liveGame, {
      shareToken: liveSession.shareToken,
      gameId: liveSession.gameId,
      expiresAt: liveSession.expiresAt.toISOString(),
    });
    assert.equal((livePublicBody.liveGame as Record<string, unknown>).stats, undefined);
    assert.equal((livePublicBody.liveGame as Record<string, unknown>).events, undefined);
    const livePublic = GetAthleteInviteResponse.parse(livePublicBody);
    assert.equal(livePublic.stats?.gamesPlayed, 1);
    assert.equal(livePublic.stats?.stats.points, 18);

    const stopped = await fetch(liveUrl, {
      method: "DELETE",
      headers: { "x-test-user": ownerId },
    });
    assert.equal(stopped.status, 204);
    const stoppedPublic = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(stoppedPublic.liveGame, null);
    assert.equal(stoppedPublic.stats?.gamesPlayed, 1);
    assert.equal(stoppedPublic.stats?.stats.points, 18);

    const attachedAgain = await fetch(liveUrl, {
      method: "POST",
      headers: { "x-test-user": ownerId },
    });
    assert.equal(attachedAgain.status, 201);
    const attachedSession = StartAthleteInviteLiveResponse.parse(await attachedAgain.json());
    const paused = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({ ...input, paused: true }),
    });
    assert.equal(paused.status, 200);
    const pausedBody = await paused.json() as {
      inviteToken: string;
      paused: boolean;
      liveTrackerShareToken: string | null;
    };
    assert.equal(pausedBody.inviteToken, created.inviteToken);
    assert.equal(pausedBody.paused, true);
    assert.equal(pausedBody.liveTrackerShareToken, null);
    assert.equal((await fetch(publicUrl)).status, 404);
    assert.deepEqual(
      await db.select({ id: statTrackerSharesTable.id })
        .from(statTrackerSharesTable)
        .where(eq(statTrackerSharesTable.id, attachedSession.shareToken)),
      [],
    );

    const resumed = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({ ...input, paused: false }),
    });
    assert.equal(resumed.status, 200);
    const resumedBody = await resumed.json() as { inviteToken: string; paused: boolean };
    assert.equal(resumedBody.inviteToken, created.inviteToken);
    assert.equal(resumedBody.paused, false);
    const resumedPublic = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(resumedPublic.inviteToken, created.inviteToken);
    assert.equal(resumedPublic.liveGame, null);
    assert.equal(resumedPublic.stats?.stats.points, 18);

    const [finalSession] = await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: "final-attached-game",
      athleteName: "Jordan",
      teamName: "City Hoops",
      game: {
        id: "final-attached-game",
        sport: "basketball",
        status: "final",
        date: dateKey(-1),
        opponent: "Comets",
        score: 42,
        opponentScore: 40,
        stats: { points: 18 },
      },
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    await db.update(athleteInvitesTable).set({
      liveTrackerShareToken: finalSession.id,
    }).where(eq(athleteInvitesTable.publicToken, created.inviteToken));
    const finalFallback = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(finalFallback.liveGame, null);
    assert.equal(finalFallback.stats?.gamesPlayed, 1);
    assert.equal(finalFallback.stats?.stats.points, 18);

    const [expiredSession] = await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: "expired-attached-game",
      athleteName: "Jordan",
      teamName: "City Hoops",
      game: {
        id: "expired-attached-game",
        sport: "basketball",
        status: "live",
        date: dateKey(0),
        opponent: "Stars",
        score: 8,
        opponentScore: 7,
        stats: { points: 6 },
      },
      expiresAt: new Date(Date.now() - 60_000),
    }).returning();
    await db.update(athleteInvitesTable).set({
      liveTrackerShareToken: expiredSession.id,
    }).where(eq(athleteInvitesTable.publicToken, created.inviteToken));
    const expiredFallback = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(expiredFallback.liveGame, null);
    assert.equal(expiredFallback.stats?.gamesPlayed, 1);
    assert.equal(expiredFallback.stats?.stats.points, 18);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});