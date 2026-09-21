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
} from "@workspace/db";
import { GetAthleteInviteResponse } from "@workspace/api-zod";

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
    await db.insert(hypeCardSharesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: hypeToken,
      slug: "latest-hype",
      title: "Game winner",
      manifest: {},
      shareMode: "card",
      mediaType: "image",
      videoObjectPath: "/test/athlete-invite.jpg",
      videoContentType: "image/jpeg",
      videoSize: 1,
      posterObjectPath: "/test/athlete-invite.jpg",
      posterContentType: "image/jpeg",
      posterSize: 1,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });

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
    assert.equal(invite.hypeCard?.shareToken, hypeToken);
    assert.equal(invite.stats?.gamesPlayed, 1);
    assert.equal(invite.stats?.stats.points, 18);
    assert.equal(invite.stats?.games.some((game) => game.opponent === "Stars"), false);
    assert.equal(invite.scheduleEvents.length, 1);
    assert.equal(invite.scheduleEvents[0]?.opponent, "Falcons");
    assert.equal("snacks" in (invite.scheduleEvents[0] ?? {}), false);

    const hidden = await fetch(publicUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        athleteName: "Jordan",
        teamName: "City Hoops",
        seasonName: "Fall 2026",
        seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        sport: "basketball",
        trackerProjectId: tracker.id,
        scheduleProjectId: schedule.id,
        showHypeCard: false,
        showStats: false,
        showSchedule: false,
      }),
    });
    assert.equal(hidden.status, 200);
    const hiddenPublic = GetAthleteInviteResponse.parse(await (await fetch(publicUrl)).json());
    assert.equal(hiddenPublic.hypeCard, null);
    assert.equal(hiddenPublic.stats, null);
    assert.deepEqual(hiddenPublic.scheduleEvents, []);

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