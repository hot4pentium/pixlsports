import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  athleteInvitesTable,
  athleteInviteHypesTable,
  athleteInviteLiveTapsTable,
  cloudProjectsTable,
  db,
  hypeCardSharesTable,
  statTrackerSharesTable,
} from "@workspace/db";
import {
  GetAthleteFanCardResponse,
  GetAthleteInviteResponse,
  StartAthleteInviteLiveResponse,
  CreateAthleteInviteLiveTapAccessLinkResponse,
  SendAthleteLiveTapResponse,
} from "@workspace/api-zod";

import athleteInvitesRouter from "./routes/athleteInvites";
import athleteLiveTapsRouter from "./routes/athleteLiveTaps";
import statTrackerSharesRouter from "./routes/statTrackerShares";
import { getLiveTapCheerPresets } from "./lib/athleteLiveTaps";

test("every supported sport offers the three shared Live Taps cheers", () => {
  const sharedCheerKeys = ["thumbs-up", "way-to-go", "big-play"];
  for (const sport of ["baseball", "softball", "basketball", "football", "soccer", "volleyball"]) {
    assert.deepEqual(
      getLiveTapCheerPresets(sport)
        .filter(({ key }) => sharedCheerKeys.includes(key))
        .map(({ key, label }) => ({ key, label })),
      [
        { key: "thumbs-up", label: "Thumbs Up" },
        { key: "way-to-go", label: "Way to Go!" },
        { key: "big-play", label: "Big Play" },
      ],
      `${sport} includes the shared Live Taps`,
    );
  }
});

function dateKey(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

test("athlete invites evolve from owned sources and revoke without exposing private activity", async () => {
  const ownerId = `athlete-invite-${randomUUID()}`;
  const otherId = `athlete-other-${randomUUID()}`;
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
  app.use("/api", athleteLiveTapsRouter);
  const server = app.listen(0);

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: otherId,
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
        mediaName: "Full-court finish",
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
        title: "Jordan · IMG_485",
        manifest: { project: { headline: "IMG_485" } },
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
    const invalidTimezone = await fetch(listUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        timezone: "not/an-iana-timezone",
        trackerProjectId: tracker.id,
        scheduleProjectId: schedule.id,
        showHypeCard: true,
        showStats: true,
        showSchedule: true,
      }),
    });
    assert.equal(invalidTimezone.status, 400);
    const create = await fetch(listUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        timezone: "America/Los_Angeles",
        trackerProjectId: tracker.id,
        scheduleProjectId: schedule.id,
        showHypeCard: true,
        showStats: true,
        showSchedule: true,
      }),
    });
    assert.equal(create.status, 201);
    const createdInvite = await create.json() as {
      inviteToken: string;
      scheduleProjectId: string | null;
      showSchedule: boolean;
    };
    assert.equal(createdInvite.scheduleProjectId, null);
    assert.equal(createdInvite.showSchedule, false);
    const owned = { inviteToken: createdInvite.inviteToken };
    const publicUrl = `${listUrl}/${owned.inviteToken}`;
    const otherHeaders = { "x-test-user": otherId };
    const cardAppearance = {
      design: "gallery", borderColor: "#EF3996", accentColor: "#22C55E", accentLinked: false,
      lowerThirdStyle: "angled",
      background: "tunnel",
      athleteX: 0.12, athleteY: -0.08, athleteScale: 1.1, jerseyNumber: "9", position: "Forward",
      avatarPlacements: {
        gallery: { athleteX: 0.12, athleteY: -0.08, athleteScale: 1.1 },
        spotlight: { athleteX: -0.08, athleteY: 0.06, athleteScale: 0.9 },
        breakout: { athleteX: 0.2, athleteY: -0.14, athleteScale: 1.2 },
      },
    };
    const appearanceUrl = `${publicUrl}/appearance`;
    assert.equal((await fetch(appearanceUrl, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(cardAppearance),
    })).status, 401);
    assert.equal((await fetch(appearanceUrl, {
      method: "PATCH", headers: { ...otherHeaders, "content-type": "application/json" }, body: JSON.stringify(cardAppearance),
    })).status, 404);
    assert.equal((await fetch(appearanceUrl, {
      method: "PATCH", headers: { "x-test-user": ownerId, "content-type": "application/json" },
      body: JSON.stringify({ ...cardAppearance, athleteScale: 99 }),
    })).status, 400);
    const appearanceSaved = await fetch(appearanceUrl, {
      method: "PATCH", headers: { "x-test-user": ownerId, "content-type": "application/json" },
      body: JSON.stringify(cardAppearance),
    });
    assert.equal(appearanceSaved.status, 200);
    assert.deepEqual((await appearanceSaved.json()).cardAppearance, cardAppearance);
    assert.deepEqual((await (await fetch(`${publicUrl}/fan`)).json()).cardAppearance, cardAppearance);
    const reloadedCards = await (await fetch(listUrl, { headers: { "x-test-user": ownerId } })).json();
    assert.deepEqual(reloadedCards[0].cardAppearance, cardAppearance);
    const textOnlyAppearance = { ...cardAppearance, lowerThirdStyle: "none" };
    const textOnlySaved = await fetch(appearanceUrl, {
      method: "PATCH", headers: { "x-test-user": ownerId, "content-type": "application/json" },
      body: JSON.stringify(textOnlyAppearance),
    });
    assert.equal(textOnlySaved.status, 200);
    assert.deepEqual((await textOnlySaved.json()).cardAppearance, textOnlyAppearance);
    assert.equal((await fetch(appearanceUrl, {
      method: "PATCH", headers: { "x-test-user": ownerId, "content-type": "application/json" },
      body: JSON.stringify({ ...cardAppearance, lowerThirdStyle: "unknown" }),
    })).status, 400);
    assert.equal((await fetch(appearanceUrl, {
      method: "PATCH", headers: { "x-test-user": ownerId, "content-type": "application/json" },
      body: JSON.stringify({ ...cardAppearance, background: "unknown" }),
    })).status, 400);
    assert.equal((await fetch(appearanceUrl, {
      method: "PATCH", headers: { "x-test-user": ownerId, "content-type": "application/json" },
      body: JSON.stringify({
        ...cardAppearance,
        avatarPlacements: {
          ...cardAppearance.avatarPlacements,
          spotlight: { ...cardAppearance.avatarPlacements.spotlight, athleteY: 3 },
        },
      }),
    })).status, 400);
    const linkedAppearance = { ...cardAppearance, design: "spotlight", accentLinked: true };
    const linkedSaved = await fetch(appearanceUrl, {
      method: "PATCH", headers: { "x-test-user": ownerId, "content-type": "application/json" }, body: JSON.stringify(linkedAppearance),
    });
    assert.equal(linkedSaved.status, 200);
    assert.equal((await linkedSaved.json()).cardAppearance.accentColor, cardAppearance.borderColor);
    const otherList = await fetch(listUrl, { headers: otherHeaders });
    assert.equal(otherList.status, 200);
    assert.deepEqual(await otherList.json(), []);
    assert.equal((await fetch(publicUrl, { headers: otherHeaders })).status, 200);
    assert.equal((await fetch(publicUrl, {
      method: "PATCH",
      headers: { ...otherHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        athleteName: "Changed by another account",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        timezone: "America/Los_Angeles",
        trackerProjectId: null,
        scheduleProjectId: null,
        showHypeCard: false,
        showStats: false,
        showSchedule: false,
        paused: true,
      }),
    })).status, 404);
    assert.equal((await fetch(`${publicUrl}/live`, { method: "POST", headers: otherHeaders })).status, 404);
    assert.equal((await fetch(`${publicUrl}/live`, { method: "DELETE", headers: otherHeaders })).status, 404);
    assert.equal((await fetch(publicUrl, { method: "DELETE", headers: otherHeaders })).status, 404);
    assert.equal((await fetch(publicUrl, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
    const publicResponse = await fetch(publicUrl);
    assert.equal(publicResponse.status, 200);
    const invite = GetAthleteInviteResponse.parse(await publicResponse.json());
    const fanBeforeLive = await fetch(`${publicUrl}/fan`);
    assert.equal(fanBeforeLive.status, 200);
    const fanBeforeLiveBody = await fanBeforeLive.json() as Record<string, unknown>;
    assert.equal("liveGame" in fanBeforeLiveBody, false);
    assert.equal(GetAthleteFanCardResponse.parse(fanBeforeLiveBody).liveScoreboard, null);
    assert.equal(invite.hypeCard?.shareToken, imageToken);
    assert.equal(invite.hypeCard?.mediaName, "Game Day highlight");
    assert.equal(invite.hypeCard?.mediaType, "image");
    assert.equal(invite.hypeCard?.posterUrl, `/api/hype-card-shares/${imageToken}/media/video`);
    assert.equal(invite.videos.length, 1);
    assert.equal(invite.videos[0]?.shareToken, hypeToken);
    assert.equal(invite.videos[0]?.title, "Full-court finish");
    assert.equal(invite.videos[0]?.mediaName, "Full-court finish");
    assert.equal(invite.videos[0]?.jerseyNumber, "23");
    assert.equal(invite.videos[0]?.position, "Guard");
    assert.equal(invite.videos[0]?.videoUrl, `/api/hype-card-shares/${hypeToken}/media/video`);
    assert.equal(invite.stats?.gamesPlayed, 1);
    assert.equal(invite.stats?.stats.points, 18);
    assert.equal(invite.stats?.games.some((game) => game.opponent === "Stars"), false);
    assert.deepEqual(invite.scheduleEvents, []);

    // Historical rows can retain Calendar linkage until the cleanup job runs.
    // Public athlete cards must ignore those columns without affecting other data.
    await db.update(athleteInvitesTable).set({
      scheduleProjectId: schedule.id,
      showSchedule: true,
    }).where(eq(athleteInvitesTable.publicToken, owned.inviteToken));
    const legacyPublic = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.deepEqual(legacyPublic.scheduleEvents, []);
    assert.equal(legacyPublic.stats?.stats.points, 18);
    assert.equal(legacyPublic.hypeCard?.shareToken, imageToken);
    assert.equal(legacyPublic.videos[0]?.shareToken, hypeToken);
    const legacyFan = GetAthleteFanCardResponse.parse(await (
      await fetch(`${publicUrl}/fan`)
    ).json());
    assert.deepEqual(legacyFan.scheduleEvents, []);

    const legacyUpdate = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        timezone: "America/Los_Angeles",
        trackerProjectId: tracker.id,
        scheduleProjectId: schedule.id,
        showHypeCard: true,
        showStats: true,
        showSchedule: true,
      }),
    });
    assert.equal(legacyUpdate.status, 200);
    const sanitizedUpdate = await legacyUpdate.json() as {
      scheduleProjectId: string | null;
      showSchedule: boolean;
    };
    assert.equal(sanitizedUpdate.scheduleProjectId, null);
    assert.equal(sanitizedUpdate.showSchedule, false);
    const sanitizedRow = (await db.select().from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.publicToken, owned.inviteToken)))[0];
    assert.equal(sanitizedRow?.scheduleProjectId, null);
    assert.equal(sanitizedRow?.showSchedule, false);

    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    const ownedAfterSourceDeletion = await (await fetch(listUrl, {
      headers: { "x-test-user": ownerId },
    })).json() as Array<{ trackerProjectId: string | null; scheduleProjectId: string | null; inviteToken: string }>;
    assert.equal(ownedAfterSourceDeletion[0]?.trackerProjectId, tracker.id);
    assert.equal(ownedAfterSourceDeletion[0]?.scheduleProjectId, null);
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
        timezone: "America/Los_Angeles",
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
        timezone: "America/Los_Angeles",
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
    assert.equal((await fetch(publicUrl, { headers: otherHeaders })).status, 404);
    const ownerPaused = await fetch(publicUrl, { headers: { "x-test-user": ownerId } });
    assert.equal(ownerPaused.status, 200);
    assert.equal(GetAthleteInviteResponse.parse(await ownerPaused.json()).inviteToken, owned.inviteToken);
    assert.equal((await fetch(listUrl, { headers: { "x-test-user": ownerId } })).status, 200);

    const resumed = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        timezone: "America/Los_Angeles",
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
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherId));
  }
});

test("public athlete invite shoutouts exclude legacy private rows and remain owner-manageable", async () => {
  const ownerId = `athlete-shoutouts-${randomUUID()}`;
  const otherId = `athlete-shoutouts-other-${randomUUID()}`;
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

  try {
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerId, role: "fan", accessMode: "full" },
      { ownerClerkUserId: otherId, role: "fan", accessMode: "full" },
    ]);
    const [invite] = await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: inviteToken,
      athleteName: "Jordan",
      teamName: "City Hoops",
      seasonName: "Fall 2026",
      seasonEndsAt: new Date(Date.now() + 90 * 86_400_000),
      sport: "basketball",
      showHypeCard: true,
      showStats: false,
      showSchedule: false,
    }).returning();
    assert.ok(invite);
    const [legacyPrivate] = await db.insert(athleteInviteHypesTable).values({
      inviteId: invite.id,
      reaction: "Great job!",
      senderName: "Private sender",
      message: "This old response stays private.",
      rateLimitKey: `legacy-${randomUUID()}`,
    }).returning();
    assert.ok(legacyPrivate);
    assert.equal(legacyPrivate.publiclyVisible, false);

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/athlete-invites/${inviteToken}`;
    const publicClientPost = await fetch(`${baseUrl}/hypes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reaction: "Let's go!",
        senderName: "Public sender",
        message: "Approved for everyone.",
        publiclyVisible: true,
      }),
    });
    assert.equal(publicClientPost.status, 201);
    const approvedPublic = (await db.select().from(athleteInviteHypesTable)
      .where(eq(athleteInviteHypesTable.inviteId, invite.id)))
      .find((row) => row.senderName === "Public sender");
    assert.ok(approvedPublic);

    const publicResponse = await fetch(`${baseUrl}/public-shoutouts`);
    assert.equal(publicResponse.status, 200);
    const publicRows = await publicResponse.json() as Array<Record<string, unknown>>;
    assert.equal(publicRows.length, 1);
    assert.equal(publicRows[0]?.id, approvedPublic.id);
    assert.deepEqual(Object.keys(publicRows[0] ?? {}).sort(), ["createdAt", "id", "message", "reaction"]);
    assert.equal(JSON.stringify(publicRows).includes("senderName"), false);
    assert.equal(JSON.stringify(publicRows).includes("rateLimitKey"), false);
    assert.equal(JSON.stringify(publicRows).includes("Private sender"), false);

    const legacyClientPost = await fetch(`${baseUrl}/hypes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reaction: "Proud of you!",
        senderName: "Legacy client",
        message: "No visibility field was sent.",
      }),
    });
    assert.equal(legacyClientPost.status, 201);
    const legacyClientRow = (await db.select().from(athleteInviteHypesTable)
      .where(eq(athleteInviteHypesTable.inviteId, invite.id)))
      .find((row) => row.senderName === "Legacy client");
    assert.equal(legacyClientRow?.publiclyVisible, false);

    assert.equal((await fetch(`${baseUrl}/hypes`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/hypes/${approvedPublic.id}`, { method: "DELETE" })).status, 401);
    const otherHeaders = { "x-test-user": otherId };
    assert.equal((await fetch(`${baseUrl}/hypes`, { headers: otherHeaders })).status, 404);
    assert.equal((await fetch(`${baseUrl}/hypes/${approvedPublic.id}`, {
      method: "DELETE",
      headers: otherHeaders,
    })).status, 404);

    const ownerHeaders = { "x-test-user": ownerId };
    const ownerRowsResponse = await fetch(`${baseUrl}/hypes`, { headers: ownerHeaders });
    assert.equal(ownerRowsResponse.status, 200);
    const ownerRows = await ownerRowsResponse.json() as Array<Record<string, unknown>>;
    assert.equal(ownerRows.length, 3);
    assert.equal(ownerRows.find((row) => row.id === approvedPublic.id)?.publiclyVisible, true);
    assert.equal(ownerRows.find((row) => row.id === legacyPrivate.id)?.publiclyVisible, false);
    assert.equal(ownerRows.find((row) => row.message === "No visibility field was sent.")?.publiclyVisible, false);
    assert.equal((await fetch(`${baseUrl}/hypes/${approvedPublic.id}`, {
      method: "DELETE",
      headers: ownerHeaders,
    })).status, 204);
    assert.deepEqual(await (await fetch(`${baseUrl}/public-shoutouts`)).json(), []);

    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await fetch(`${baseUrl}/public-shoutouts`)).status, 404);
    await db.update(athleteInvitesTable).set({ paused: false }).where(eq(athleteInvitesTable.id, invite.id));
    await db.update(accountAccessTable).set({ lifecycleStatus: "paused" })
      .where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    assert.equal((await fetch(`${baseUrl}/public-shoutouts`)).status, 404);
    assert.equal((await fetch(
      `http://127.0.0.1:${address.port}/api/athlete-invites/${randomBytes(24).toString("base64url")}/public-shoutouts`,
    )).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherId));
  }
});

test("athlete pages expose at most three active videos newest first and ignore image shares", async () => {
  const ownerId = `athlete-videos-${randomUUID()}`;
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
    assert.equal(invite.videos.length, 3);
    assert.equal(invite.videos[0]?.title, "Moment 11");
    assert.equal(invite.videos[0]?.jerseyNumber, "31");
    assert.equal(invite.videos[0]?.position, "Point guard");
    assert.equal(invite.videos.at(-1)?.title, "Moment 9");
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
  const otherId = `athlete-live-other-${randomUUID()}`;
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
  app.use("/api", athleteLiveTapsRouter);
  app.use("/api", statTrackerSharesRouter);
  const server = app.listen(0);

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: otherId,
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
      timezone: "America/Los_Angeles",
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
    const linkedFromTracker = await fetch(liveUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({ shareToken: liveSession.shareToken }),
    });
    assert.equal(linkedFromTracker.status, 201);
    assert.deepEqual(
      StartAthleteInviteLiveResponse.parse(await linkedFromTracker.json()),
      liveSession,
    );
    const accessLinksUrl = `${publicUrl}/live-taps/access-links`;
    const tapUrl = `${publicUrl}/live-taps`;
    assert.equal((await fetch(accessLinksUrl)).status, 401);
    assert.equal((await fetch(accessLinksUrl, {
      method: "POST",
      headers: { "x-test-user": otherId },
    })).status, 404);
    assert.equal((await fetch(tapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cheerKey: "bucket" }),
    })).status, 403);
    const createdLinkResponse = await fetch(accessLinksUrl, {
      method: "POST",
      headers: { "x-test-user": ownerId },
    });
    assert.equal(createdLinkResponse.status, 201);
    const familyLink = CreateAthleteInviteLiveTapAccessLinkResponse.parse(await createdLinkResponse.json());
    assert.match(familyLink.accessToken, /^[A-Za-z0-9_-]{40,100}$/);
    assert.equal((await fetch(accessLinksUrl, { headers: { "x-test-user": otherId } })).status, 404);
    const listedLinksResponse = await fetch(accessLinksUrl, { headers: { "x-test-user": ownerId } });
    const listedLinks = await listedLinksResponse.json() as Array<Record<string, unknown>>;
    assert.equal(listedLinksResponse.status, 200);
    assert.equal(listedLinks.length, 1);
    assert.equal(listedLinks[0]?.id, familyLink.id);
    assert.equal("accessToken" in (listedLinks[0] ?? {}), false);

    assert.equal((await fetch(tapUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": otherId },
      body: JSON.stringify({ cheerKey: "bucket" }),
    })).status, 403);
    assert.equal((await fetch(tapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cheerKey: "touchdown", accessToken: familyLink.accessToken }),
    })).status, 400);
    const tapResponse = await fetch(tapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cheerKey: "bucket", accessToken: familyLink.accessToken }),
    });
    assert.equal(tapResponse.status, 201);
    const tapSummary = SendAthleteLiveTapResponse.parse(await tapResponse.json());
    assert.equal(tapSummary.active, true);
    assert.equal(tapSummary.gameId, liveSession.gameId);
    assert.equal(tapSummary.cheers.find((cheer) => cheer.key === "bucket")?.count, 1);
    assert.deepEqual(
      tapSummary.cheers.filter((cheer) => ["thumbs-up", "way-to-go", "big-play"].includes(cheer.key))
        .map(({ key, label }) => ({ key, label })),
      [
        { key: "thumbs-up", label: "Thumbs Up" },
        { key: "way-to-go", label: "Way to Go!" },
        { key: "big-play", label: "Big Play" },
      ],
      "every sport includes the shared cheers in its live tally",
    );
    for (const cheerKey of ["thumbs-up", "way-to-go", "big-play"]) {
      const sharedCheerResponse = await fetch(tapUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cheerKey, accessToken: familyLink.accessToken }),
      });
      assert.equal(sharedCheerResponse.status, 201, `${cheerKey} is accepted for this sport`);
      const sharedCheerSummary = SendAthleteLiveTapResponse.parse(await sharedCheerResponse.json());
      assert.equal(sharedCheerSummary.cheers.find((cheer) => cheer.key === cheerKey)?.count, 1);
    }
    const concurrentTaps = await Promise.all(Array.from({ length: 8 }, () => fetch(tapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cheerKey: "bucket", accessToken: familyLink.accessToken }),
    })));
    assert.ok(concurrentTaps.every((response) => response.status === 201));

    const [inviteRow] = await db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.publicToken, created.inviteToken));
    assert.ok(inviteRow);
    await db.insert(athleteInviteLiveTapsTable).values({
      inviteId: inviteRow.id,
      gameId: "previous-game",
      cheerKey: "bucket",
    });
    const fanWithTap = GetAthleteFanCardResponse.parse(await (await fetch(`${publicUrl}/fan`)).json());
    assert.equal(fanWithTap.liveTaps.gameId, liveSession.gameId);
    assert.equal(fanWithTap.liveTaps.cheers.find((cheer) => cheer.key === "bucket")?.count, 9);

    const revokedLink = await fetch(`${accessLinksUrl}/${familyLink.id}`, {
      method: "DELETE",
      headers: { "x-test-user": ownerId },
    });
    assert.equal(revokedLink.status, 204);
    assert.deepEqual(await (await fetch(accessLinksUrl, { headers: { "x-test-user": ownerId } })).json(), []);
    assert.equal((await fetch(tapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cheerKey: "bucket", accessToken: familyLink.accessToken }),
    })).status, 403);

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
    const fanCardResponse = await fetch(`${publicUrl}/fan`);
    assert.equal(fanCardResponse.status, 200);
    const fanCardBody = await fanCardResponse.json() as Record<string, unknown>;
    assert.equal("liveGame" in fanCardBody, false);
    const fanCard = GetAthleteFanCardResponse.parse(fanCardBody);
    assert.deepEqual(fanCard.liveScoreboard, {
      score: 8,
      opponentScore: 7,
      opponent: "Stars",
      status: "live",
      period: 2,
      athleteName: "Jordan",
      teamName: "City Hoops",
    });
    assert.equal(JSON.stringify(fanCard.liveScoreboard).includes("events"), false);
    assert.equal(JSON.stringify(fanCardBody).includes("never expose this live snapshot"), false);

    const stopped = await fetch(liveUrl, {
      method: "DELETE",
      headers: { "x-test-user": ownerId },
    });
    assert.equal(stopped.status, 204);
    const stoppedPublic = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(stoppedPublic.liveGame, null);
    assert.equal(stoppedPublic.stats?.gamesPlayed, 1);
    assert.equal(stoppedPublic.stats?.stats.points, 18);
    assert.equal(stoppedPublic.liveTaps.active, false);
    assert.equal(stoppedPublic.liveTaps.gameId, null);
    const savedTaps = await db.select({
      gameId: athleteInviteLiveTapsTable.gameId,
      cheerKey: athleteInviteLiveTapsTable.cheerKey,
    }).from(athleteInviteLiveTapsTable).where(eq(athleteInviteLiveTapsTable.inviteId, inviteRow.id));
    assert.deepEqual(savedTaps.sort((left, right) => `${left.gameId}:${left.cheerKey}`.localeCompare(`${right.gameId}:${right.cheerKey}`)), [
      ...Array.from({ length: 9 }, () => ({ gameId: liveSession.gameId, cheerKey: "bucket" })),
      { gameId: liveSession.gameId, cheerKey: "thumbs-up" },
      { gameId: liveSession.gameId, cheerKey: "way-to-go" },
      { gameId: liveSession.gameId, cheerKey: "big-play" },
      { gameId: "previous-game", cheerKey: "bucket" },
    ].sort((left, right) => `${left.gameId}:${left.cheerKey}`.localeCompare(`${right.gameId}:${right.cheerKey}`)));

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

    const finalizingGame = {
      id: "closing-live-game",
      sport: "basketball",
      status: "live",
      date: dateKey(0),
      opponent: "Stars",
      period: 2,
      score: 8,
      opponentScore: 7,
      stats: { points: 6 },
      trackYards: false,
      yardStats: {},
      events: [],
    };
    const [finalizingShare] = await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: finalizingGame.id,
      athleteName: "Jordan",
      teamName: "City Hoops",
      game: finalizingGame,
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    await db.update(athleteInvitesTable).set({
      liveTrackerShareToken: finalizingShare.id,
    }).where(eq(athleteInvitesTable.publicToken, created.inviteToken));
    await db.insert(athleteInviteLiveTapsTable).values({
      inviteId: inviteRow.id,
      gameId: finalizingGame.id,
      cheerKey: "bucket",
    });
    const tapsBeforeFinal = await db.select({
      gameId: athleteInviteLiveTapsTable.gameId,
      cheerKey: athleteInviteLiveTapsTable.cheerKey,
    }).from(athleteInviteLiveTapsTable).where(eq(athleteInviteLiveTapsTable.inviteId, inviteRow.id));
    const finalUpdate = await fetch(`${baseUrl}/api/stat-tracker-shares/${finalizingShare.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        game: { ...finalizingGame, status: "final" },
        expectedRevision: finalizingShare.revision,
      }),
    });
    assert.equal(finalUpdate.status, 200);
    const detachedInvite = await db.select({
      liveTrackerShareToken: athleteInvitesTable.liveTrackerShareToken,
    }).from(athleteInvitesTable).where(eq(athleteInvitesTable.id, inviteRow.id));
    assert.equal(detachedInvite[0]?.liveTrackerShareToken, null);
    const closedFanCard = GetAthleteFanCardResponse.parse(await (await fetch(`${publicUrl}/fan`)).json());
    assert.equal(closedFanCard.liveScoreboard, null);
    assert.equal(closedFanCard.liveTaps.active, false);
    assert.deepEqual(
      await db.select({
        gameId: athleteInviteLiveTapsTable.gameId,
        cheerKey: athleteInviteLiveTapsTable.cheerKey,
      }).from(athleteInviteLiveTapsTable).where(eq(athleteInviteLiveTapsTable.inviteId, inviteRow.id)),
      tapsBeforeFinal,
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherId));
  }
});

test("an existing Hype Page finds its first finalized tracker project after the first game", async () => {
  const ownerId = `athlete-first-game-${randomUUID()}`;
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
    await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "First game tracker",
      project: {
        tool: "stat-tracker",
        games: [{
          id: "first-final-game",
          sport: "volleyball",
          status: "final",
          date: dateKey(0),
          opponent: "Tigers",
          score: 6,
          opponentScore: 0,
          stats: { ace: 4 },
        }],
      },
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const create = await fetch(`${baseUrl}/api/athlete-invites`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Volleyball",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "volleyball",
        timezone: "America/Los_Angeles",
        trackerProjectId: null,
        scheduleProjectId: null,
        showHypeCard: false,
        showStats: true,
        showSchedule: false,
        paused: false,
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { inviteToken: string };

    const publicResponse = await fetch(`${baseUrl}/api/athlete-invites/${created.inviteToken}`);
    assert.equal(publicResponse.status, 200);
    const publicBody = GetAthleteInviteResponse.parse(await publicResponse.json());
    assert.equal(publicBody.stats?.gamesPlayed, 1);
    assert.equal(publicBody.stats?.stats.ace, 4);
    assert.equal(publicBody.stats?.games[0]?.opponent, "Tigers");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});