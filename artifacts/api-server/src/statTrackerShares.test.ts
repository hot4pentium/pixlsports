import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { and, eq } from "drizzle-orm";
import {
  accountAccessTable,
  athleteInvitesTable,
  db,
  statTrackerSharesTable,
} from "@workspace/db";
import {
  CreateStatTrackerShareBody,
  CreateStatTrackerShareResponse,
  ListStatTrackerSharesResponse,
  UpdateStatTrackerShareBody,
  UpdateStatTrackerShareResponse,
} from "@workspace/api-zod";
import statTrackerSharesRouter, { getPublicEvents } from "./routes/statTrackerShares";

const game = {
  id: "tracker-game-1",
  sport: "football" as const,
  status: "live" as const,
  date: "2026-09-20",
  opponent: "Northside",
  period: 2,
  score: 14,
  opponentScore: 7,
  stats: { "pass-yard": 2, tackle: 1 },
  trackYards: true,
  yardStats: { "pass-yard": 18 },
  events: [{
    id: "tracker-event-1",
    statId: "pass-yard",
    createdAt: "2026-09-20T18:01:00.000Z",
    period: 2,
    yards: 12,
  }, {
    id: "tracker-event-2",
    statId: "tackle",
    createdAt: "2026-09-20T18:02:00.000Z",
    period: 2,
    attribution: "athlete" as const,
    yards: null,
  }],
};

class ApiContractError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(`Expected API request to succeed, got ${status}`);
  }
}

async function requestJson<T>(
  baseUrl: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  userId: string,
  body: unknown,
  parse: (value: unknown) => T,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new ApiContractError(response.status, data);
  return parse(data);
}

test("stat tracker shares sanitize snapshots, stream revisions, and enforce owner revocation", async () => {
  const ownerId = `tracker-share-owner-${crypto.randomUUID()}`;
  const viewerId = `tracker-share-viewer-${crypto.randomUUID()}`;
  const foreignId = `tracker-share-foreign-${crypto.randomUUID()}`;
  const publicToken = crypto.randomUUID();
  const app = express();
  const eventsAbortController = new AbortController();

  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", statTrackerSharesRouter);

  const server = app.listen(0);
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: foreignId,
      role: "fan",
      accessMode: "full",
    });
    await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: ownerId,
      publicToken,
      athleteName: "Maya",
      teamName: "Falcons",
      seasonName: "Fall 2026",
      seasonEndsAt: new Date("2027-01-01T00:00:00.000Z"),
      sport: "football",
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const input = CreateStatTrackerShareBody.parse({
      athleteName: "Maya",
      teamName: "Falcons",
      game,
    });
    const created = await requestJson(
      baseUrl,
      "POST",
      "/api/stat-tracker-shares",
      ownerId,
      input,
      CreateStatTrackerShareResponse.parse,
    );
    assert.match(created.shareToken, /^[0-9a-f-]{36}$/);
    assert.equal(created.revision, 1);
    assert.equal(created.canManage, true);
    assert.ok(created.expiresAt.getTime() > Date.now());

    const publicView = await requestJson(
      baseUrl,
      "GET",
      `/api/stat-tracker-shares/${created.shareToken}`,
      viewerId,
      undefined,
      CreateStatTrackerShareResponse.parse,
    );
    assert.equal(publicView.canManage, false);
    assert.equal(publicView.game.events.length, 2);
    assert.equal(publicView.game.events[0]?.attribution, "team");
    assert.equal(publicView.game.events[1]?.attribution, "athlete");
    assert.equal(publicView.publicFanCardPath, null, "live scoreboards do not offer the follow link");
    assert.equal((publicView as unknown as Record<string, unknown>).ownerClerkUserId, undefined);
    assert.equal((publicView.game as unknown as Record<string, unknown>).notes, undefined);
    const boundaryEvents = [
      { id: "boundary-pass", statId: "pass-yard", playId: "boundary-play", createdAt: "2026-09-20T18:00:00.000Z", period: 2, attribution: "team", yards: 18 },
      { id: "boundary-reception", statId: "reception", playId: "boundary-play", createdAt: "2026-09-20T18:00:00.000Z", period: 2, attribution: "team", yards: 18 },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `boundary-filler-${index}`,
        statId: "tackle",
        createdAt: `2026-09-20T18:0${index + 1}:00.000Z`,
        period: 2,
        attribution: "athlete",
        yards: null,
      })),
    ];
    const visibleBoundaryEvents = getPublicEvents(boundaryEvents);
    assert.equal(visibleBoundaryEvents.length, 10);
    assert.deepEqual(visibleBoundaryEvents.slice(0, 2).map((event) => (event as { id: string }).id), ["boundary-pass", "boundary-reception"]);

    const streamResponse = await fetch(`${baseUrl}/api/stat-tracker-shares/${created.shareToken}/events`, {
      signal: eventsAbortController.signal,
    });
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get("content-type") || "", /^text\/event-stream/);
    const reader = streamResponse.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let buffered = "";
    const readEvent = async (expected: string) => {
      while (!buffered.includes(expected)) {
        const result = await reader.read();
        assert.equal(result.done, false);
        buffered += decoder.decode(result.value, { stream: true });
      }
      const result = buffered;
      buffered = "";
      return result;
    };
    assert.match(await readEvent('"revision":1'), /event: stat-tracker/);

    const update = await requestJson(
      baseUrl,
      "PATCH",
      `/api/stat-tracker-shares/${created.shareToken}`,
      ownerId,
      UpdateStatTrackerShareBody.parse({
        ...input,
        game: { ...game, score: 21, status: "paused" },
        expectedRevision: 1,
      }),
      UpdateStatTrackerShareResponse.parse,
    );
    assert.equal(update.revision, 2);
    assert.equal(update.game.score, 21);
    assert.equal(update.publicFanCardPath, null, "paused scoreboards do not offer the follow link");
    assert.match(await readEvent('"revision":2'), /"score":21/);

    const finalUpdate = await requestJson(
      baseUrl,
      "PATCH",
      `/api/stat-tracker-shares/${created.shareToken}`,
      ownerId,
      UpdateStatTrackerShareBody.parse({
        ...input,
        game: { ...game, score: 21, status: "final" },
        expectedRevision: 2,
      }),
      UpdateStatTrackerShareResponse.parse,
    );
    assert.equal(finalUpdate.publicFanCardPath, `/fan/${publicToken}`);
    assert.match(await readEvent('"revision":3'), new RegExp(`/fan/${publicToken}`));

    await db.update(athleteInvitesTable)
      .set({ showHypeCard: false })
      .where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    const hiddenCardView = await requestJson(
      baseUrl,
      "GET",
      `/api/stat-tracker-shares/${created.shareToken}`,
      viewerId,
      undefined,
      CreateStatTrackerShareResponse.parse,
    );
    assert.equal(hiddenCardView.publicFanCardPath, null, "hidden HYPE Cards are not promoted from a final scoreboard");

    await db.update(athleteInvitesTable)
      .set({ showHypeCard: true, paused: true })
      .where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    const pausedCardView = await requestJson(
      baseUrl,
      "GET",
      `/api/stat-tracker-shares/${created.shareToken}`,
      viewerId,
      undefined,
      CreateStatTrackerShareResponse.parse,
    );
    assert.equal(pausedCardView.publicFanCardPath, null, "paused HYPE Cards are not promoted from a final scoreboard");

    await db.update(athleteInvitesTable)
      .set({ paused: false, athleteName: "Jordan" })
      .where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    const differentAthleteView = await requestJson(
      baseUrl,
      "GET",
      `/api/stat-tracker-shares/${created.shareToken}`,
      viewerId,
      undefined,
      CreateStatTrackerShareResponse.parse,
    );
    assert.equal(differentAthleteView.publicFanCardPath, null, "a card for another athlete is not linked");

    await assert.rejects(
      () => requestJson(
        baseUrl,
        "PATCH",
        `/api/stat-tracker-shares/${created.shareToken}`,
        foreignId,
        UpdateStatTrackerShareBody.parse({ ...input, expectedRevision: 2 }),
        UpdateStatTrackerShareResponse.parse,
      ),
      (error: unknown) => error instanceof ApiContractError && error.status === 404,
    );
    await assert.rejects(
      () => requestJson(
        baseUrl,
        "PATCH",
        `/api/stat-tracker-shares/${created.shareToken}`,
        ownerId,
        UpdateStatTrackerShareBody.parse({ ...input, expectedRevision: 1 }),
        UpdateStatTrackerShareResponse.parse,
      ),
      (error: unknown) => {
        assert.ok(error instanceof ApiContractError);
        assert.equal(error.status, 409);
        assert.equal((error.data as { current: typeof update }).current.revision, 3);
        return true;
      },
    );

    await requestJson(
      baseUrl,
      "DELETE",
      `/api/stat-tracker-shares/${created.shareToken}`,
      foreignId,
      undefined,
      () => undefined,
    ).then(
      () => assert.fail("foreign owner unexpectedly revoked share"),
      (error: unknown) => assert.ok(error instanceof ApiContractError && error.status === 404),
    );
    await requestJson(
      baseUrl,
      "DELETE",
      `/api/stat-tracker-shares/${created.shareToken}`,
      ownerId,
      undefined,
      () => undefined,
    );
    await assert.rejects(
      () => requestJson(
        baseUrl,
        "GET",
        `/api/stat-tracker-shares/${created.shareToken}`,
        viewerId,
        undefined,
        CreateStatTrackerShareResponse.parse,
      ),
      (error: unknown) => error instanceof ApiContractError && error.status === 404,
    );
    assert.match(await readEvent("revoked"), /event: revoked/);
  } finally {
    eventsAbortController.abort();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, foreignId));
  }
});

test("expired stat tracker shares are not readable", async () => {
  const ownerId = `tracker-share-expired-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", statTrackerSharesRouter);
  const server = app.listen(0);
  try {
    await db.insert(accountAccessTable).values({ ownerClerkUserId: ownerId, role: "fan", accessMode: "full" });
    const [share] = await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: game.id,
      athleteName: "Maya",
      teamName: "Falcons",
      game,
      expiresAt: new Date(Date.now() - 1000),
    }).returning();
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/stat-tracker-shares/${share.id}`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("inactive account stat tracker shares are not readable or streamable", async () => {
  const ownerId = `tracker-share-inactive-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", statTrackerSharesRouter);
  const server = app.listen(0);
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
      lifecycleStatus: "cancelled",
    });
    const [share] = await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: game.id,
      athleteName: "Maya",
      teamName: "Falcons",
      game,
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/stat-tracker-shares/${share.id}`;
    assert.equal((await fetch(baseUrl)).status, 404);
    assert.equal((await fetch(`${baseUrl}/events`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("owner share list requires auth and excludes other owners and expired shares", async () => {
  const ownerId = `tracker-share-list-owner-${crypto.randomUUID()}`;
  const otherId = `tracker-share-list-other-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", statTrackerSharesRouter);
  const server = app.listen(0);
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const now = Date.now();
    const rows = await db.insert(statTrackerSharesTable).values([
      {
        ownerClerkUserId: ownerId,
        gameId: game.id,
        athleteName: "Older",
        teamName: "Falcons",
        game,
        expiresAt: new Date(now + 60_000),
        createdAt: new Date(now - 10_000),
      },
      {
        ownerClerkUserId: ownerId,
        gameId: "newest-game",
        athleteName: "Newest",
        teamName: "Falcons",
        game: { ...game, id: "newest-game" },
        expiresAt: new Date(now + 60_000),
        createdAt: new Date(now),
      },
      {
        ownerClerkUserId: ownerId,
        gameId: "expired-game",
        athleteName: "Expired",
        teamName: "Falcons",
        game: { ...game, id: "expired-game" },
        expiresAt: new Date(now - 1_000),
        createdAt: new Date(now + 1_000),
      },
      {
        ownerClerkUserId: otherId,
        gameId: "other-game",
        athleteName: "Other",
        teamName: "Visitors",
        game: { ...game, id: "other-game" },
        expiresAt: new Date(now + 60_000),
      },
    ]).returning();
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/stat-tracker-shares`;
    assert.equal((await fetch(url)).status, 401);

    const response = await fetch(url, { headers: { "x-test-user": ownerId } });
    assert.equal(response.status, 200);
    const listed = ListStatTrackerSharesResponse.parse(await response.json());
    assert.deepEqual(listed.map((share) => share.athleteName), ["Newest", "Older"]);
    assert.ok(listed.every((share) => share.canManage));
    assert.ok(listed.every((share) => share.shareToken !== rows[2].id && share.shareToken !== rows[3].id));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, otherId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("duplicate creates return one active token sequentially and concurrently", async () => {
  const ownerId = `tracker-share-duplicate-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", statTrackerSharesRouter);
  const server = app.listen(0);
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/stat-tracker-shares`;
    const body = CreateStatTrackerShareBody.parse({
      athleteName: "Maya",
      teamName: "Falcons",
      game,
    });
    const first = await requestJson(url, "POST", "", ownerId, body, CreateStatTrackerShareResponse.parse);
    const second = await requestJson(url, "POST", "", ownerId, body, CreateStatTrackerShareResponse.parse);
    assert.equal(second.shareToken, first.shareToken);

    const concurrent = await Promise.all(Array.from({ length: 8 }, () => requestJson(
      url,
      "POST",
      "",
      ownerId,
      body,
      CreateStatTrackerShareResponse.parse,
    )));
    assert.deepEqual(new Set(concurrent.map((share) => share.shareToken)), new Set([first.shareToken]));
    const stored = await db.select().from(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.ownerClerkUserId, ownerId),
      eq(statTrackerSharesTable.gameId, game.id),
    ));
    assert.equal(stored.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});