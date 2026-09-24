import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  athleteInvitesTable,
  checklistSharesTable,
  db,
  scheduleSharesTable,
  statTrackerSharesTable,
} from "@workspace/db";
import {
  CreateChecklistShareBody,
  CreateChecklistShareResponse,
  CreateScheduleShareBody,
  CreateScheduleShareResponse,
  GetGameOnCardResponse,
} from "@workspace/api-zod";
import checklistSharesRouter from "./checklistShares";
import scheduleSharesRouter from "./scheduleShares";

test("public Game On Card hides private event prep and only exposes deliberate destinations", async () => {
  const ownerId = `game-on-owner-${crypto.randomUUID()}`;
  const eventId = `game-on-event-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    next();
  });
  app.use("/api", scheduleSharesRouter);
  app.use("/api", checklistSharesRouter);

  const server = app.listen(0);
  let shareId: string | undefined;
  let shareToken = "";
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const scheduleBody = CreateScheduleShareBody.parse({
      title: "Tigers",
      teamSeason: "Fall 2026",
      events: [{
        id: eventId,
        type: "game",
        status: "upcoming",
        date: "2026-10-03",
        time: "09:30",
        location: "North Field",
        opponent: "Ravens",
        snacks: "PRIVATE SNACKS",
        drinks: "PRIVATE DRINKS",
        notes: "PRIVATE EVENT NOTES",
      }],
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const createdResponse = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify(scheduleBody),
    });
    assert.equal(createdResponse.status, 201);
    const createdShare = CreateScheduleShareResponse.parse(await createdResponse.json());
    shareId = createdShare.shareToken;
    shareToken = createdShare.shareToken;

    await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: `${eventId}-other`,
      athleteName: "Alex Tiger",
      teamName: "Tigers",
      game: { status: "live", opponent: "Falcons" },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const response = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/${shareToken}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    const card = GetGameOnCardResponse.parse(await response.json());

    assert.equal(card.stage, "upcoming");
    assert.equal(card.prepState, "private");
    assert.equal(card.statsState, "not-shared");
    assert.equal(card.athletePageState, "unpublished");
    assert.equal(card.event.id, eventId);
    assert.equal(card.event.opponent, "Ravens");
    assert.deepEqual(
      Object.keys(card.event).sort(),
      ["date", "id", "location", "opponent", "status", "time", "type"].sort(),
    );
    const publicJson = JSON.stringify(card);
    assert.doesNotMatch(publicJson, /PRIVATE (SNACKS|DRINKS|EVENT NOTES)/);
    assert.equal("prepShareToken" in card, false);
    assert.equal("statsShareToken" in card, false);
    assert.equal("statsUpdatedAt" in card, false);
    assert.equal("athletePageToken" in card, false);

    const checklistBody = CreateChecklistShareBody.parse({
      title: "Tigers game prep",
      mode: "gameday",
      items: [{ id: "water", label: "Bring water", completed: false, section: "Before leaving" }],
      selectedGame: {
        id: eventId,
        type: "game",
        date: "2026-10-03",
        time: "09:30",
        location: "North Field",
        opponent: "Ravens",
      },
      notes: "Private until the owner creates this helper link.",
    });
    const checklistResponse = await fetch(`http://127.0.0.1:${address.port}/api/checklist-shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify(checklistBody),
    });
    assert.equal(checklistResponse.status, 201);
    const checklist = CreateChecklistShareResponse.parse(await checklistResponse.json());

    const withPrepResponse = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/${shareToken}`);
    const withPrep = GetGameOnCardResponse.parse(await withPrepResponse.json());
    assert.equal(withPrep.prepState, "shared");
    assert.equal(withPrep.prepShareToken, checklist.shareToken);
    assert.doesNotMatch(JSON.stringify(withPrep), /PRIVATE (SNACKS|DRINKS|EVENT NOTES)/);

    const [trackerShare] = await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: eventId,
      athleteName: "Alex Tiger",
      teamName: "Tigers",
      game: { status: "live", opponent: "Ravens" },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }).returning();
    await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: `athlete-${crypto.randomUUID()}`,
      athleteName: "Alex Tiger",
      teamName: "Tigers",
      seasonName: "Fall 2026",
      seasonEndsAt: new Date("2026-12-01T00:00:00.000Z"),
      sport: "soccer",
    });
    const linkedResponse = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/${shareToken}`);
    const linkedCard = GetGameOnCardResponse.parse(await linkedResponse.json());
    assert.equal(linkedCard.statsState, "live");
    assert.equal(linkedCard.statsShareToken, trackerShare.id);
    assert.equal(linkedCard.statsUpdatedAt?.toISOString(), trackerShare.updatedAt.toISOString());
    assert.equal(linkedCard.athletePageState, "published");
    assert.equal(linkedCard.athleteName, "Alex Tiger");
    assert.ok(linkedCard.athletePageToken);

    const refreshedAt = new Date("2026-10-03T15:20:00.000Z");
    await db.update(statTrackerSharesTable).set({
      game: { status: "final", opponent: "Ravens" },
      updatedAt: refreshedAt,
    }).where(eq(statTrackerSharesTable.id, trackerShare.id));
    const refreshedResponse = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/${shareToken}`);
    const refreshedCard = GetGameOnCardResponse.parse(await refreshedResponse.json());
    assert.equal(refreshedCard.statsState, "final");
    assert.equal(refreshedCard.statsShareToken, trackerShare.id);
    assert.equal(refreshedCard.statsUpdatedAt?.toISOString(), refreshedAt.toISOString());
    assert.notEqual(refreshedCard.statsUpdatedAt?.toISOString(), linkedCard.statsUpdatedAt?.toISOString());

    await db.update(statTrackerSharesTable).set({
      expiresAt: new Date(Date.now() - 60 * 1000),
    }).where(eq(statTrackerSharesTable.id, trackerShare.id));
    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    const completedResponse = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/${shareToken}`);
    const completedCard = GetGameOnCardResponse.parse(await completedResponse.json());
    assert.equal(completedCard.stage, "final");
    assert.equal(completedCard.statsState, "expired");
    assert.equal("statsShareToken" in completedCard, false);
    assert.equal("statsUpdatedAt" in completedCard, false);
    assert.equal(completedCard.athletePageState, "paused");
    assert.equal("athletePageToken" in completedCard, false);

    const revokeResponse = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares/${shareToken}`, {
      method: "DELETE",
      headers: { "x-test-user": ownerId },
    });
    assert.equal(revokeResponse.status, 204);
    const revokedResponse = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/${shareToken}`);
    assert.equal(revokedResponse.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (shareId) await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, shareId));
    await db.delete(checklistSharesTable).where(eq(checklistSharesTable.ownerClerkUserId, ownerId));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});