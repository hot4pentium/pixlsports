import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  athleteInvitesTable,
  checklistSharesTable,
  cloudProjectsTable,
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
  ListOwnedGameOnCardsResponse,
} from "@workspace/api-zod";
import checklistSharesRouter from "./checklistShares";
import scheduleSharesRouter, { GAME_ON_CARD_MARKER } from "./scheduleShares";

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
      purpose: "game-on-card",
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

    const retiredLegacyUrl = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares/${shareToken}`);
    assert.equal(retiredLegacyUrl.status, 404);
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

test("owned Game On Cards lists only the caller's single game and practice shares", async () => {
  const ownerId = `owned-game-on-owner-${crypto.randomUUID()}`;
  const otherOwnerId = `owned-game-on-other-${crypto.randomUUID()}`;
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
  const server = app.listen(0);
  const insertedIds: string[] = [];
  try {
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerId, role: "fan", accessMode: "full" },
      { ownerClerkUserId: otherOwnerId, role: "fan", accessMode: "full" },
    ]);
    const insertShare = async (
      ownerClerkUserId: string,
      type: "game" | "practice" | "meeting",
      eventCount = 1,
      marked = true,
    ) => {
      const [share] = await db.insert(scheduleSharesTable).values({
        ownerClerkUserId,
        title: `${type} schedule`,
        teamSeason: marked ? GAME_ON_CARD_MARKER : "Fall 2026",
        events: Array.from({ length: eventCount }, (_, index) => ({
          id: `${type}-${crypto.randomUUID()}-${index}`,
          type,
          date: "2026-10-03",
          time: "09:30",
          location: "North Field",
          opponent: "Ravens",
          snacks: "Private",
          drinks: "Private",
          notes: "Private",
        })),
      }).returning();
      insertedIds.push(share.id);
      return share;
    };
    const gameShare = await insertShare(ownerId, "game");
    const practiceShare = await insertShare(ownerId, "practice");
    await insertShare(ownerId, "meeting");
    await insertShare(ownerId, "game", 2);
    const calendarShare = await insertShare(ownerId, "game", 1, false);
    const unmarkedMeetingShare = await insertShare(ownerId, "meeting", 1, false);
    const otherShare = await insertShare(otherOwnerId, "practice");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const unauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/owned`);
    assert.equal(unauthorizedResponse.status, 401);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/owned`, {
      headers: { "x-test-user": ownerId },
    });
    assert.equal(response.status, 200);
    const shares = ListOwnedGameOnCardsResponse.parse(await response.json());
    assert.deepEqual(new Set(shares.map((share) => share.shareToken)), new Set([
      gameShare.id,
      practiceShare.id,
    ]));
    assert.equal(shares.some((share) => share.shareToken === otherShare.id), false);
    assert.equal(shares.some((share) => share.shareToken === calendarShare.id), false);
    assert.equal(shares.some((share) => share.shareToken === unmarkedMeetingShare.id), false);
    assert.ok(shares.every((share) => share.teamSeason === ""));
    assert.ok(shares.every((share) => share.events.length === 1
      && (share.events[0]?.type === "game" || share.events[0]?.type === "practice")));
    const calendarResponse = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares/${calendarShare.id}`);
    assert.equal(calendarResponse.status, 404);
    const unmarkedLegacyCardResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/game-on-cards/${calendarShare.id}`,
    );
    assert.equal(unmarkedLegacyCardResponse.status, 200);
    const legacyCard = GetGameOnCardResponse.parse(await unmarkedLegacyCardResponse.json());
    assert.equal(legacyCard.event.type, "game");
    assert.equal(legacyCard.event.opponent, "Ravens");
    assert.equal("notes" in legacyCard.event, false);
    const unmarkedMeetingResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/game-on-cards/${unmarkedMeetingShare.id}`,
    );
    assert.equal(unmarkedMeetingResponse.status, 404);

    const legacyCreateResponse = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        title: "Retired calendar",
        teamSeason: "Fall 2026",
        events: [{
          id: "legacy-calendar-event",
          type: "game",
          date: "2026-10-03",
          time: "09:30",
          location: "North Field",
          opponent: "Ravens",
          snacks: "",
          drinks: "",
          notes: "",
        }],
      }),
    });
    assert.equal(legacyCreateResponse.status, 410);

    const convertCalendarToCardResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/schedule-shares/${calendarShare.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-test-user": ownerId },
        body: JSON.stringify({
          title: "Converted calendar",
          teamSeason: "Fall 2026",
          purpose: "game-on-card",
          events: [{
            id: "calendar-to-card",
            type: "game",
            date: "2026-10-03",
            time: "09:30",
            location: "North Field",
            opponent: "Ravens",
            snacks: "",
            drinks: "",
            notes: "",
          }],
        }),
      },
    );
    assert.equal(convertCalendarToCardResponse.status, 410);

    const convertCardToCalendarResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/schedule-shares/${gameShare.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-test-user": ownerId },
        body: JSON.stringify({
          title: "Converted card",
          teamSeason: "Fall 2026",
          events: [{
            id: "card-to-calendar",
            type: "game",
            date: "2026-10-03",
            time: "09:30",
            location: "North Field",
            opponent: "Ravens",
            snacks: "",
            drinks: "",
            notes: "",
          }],
        }),
      },
    );
    assert.equal(convertCardToCalendarResponse.status, 410);

    const cardUpdateResponse = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares/${gameShare.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        title: "Updated Game On Card",
        teamSeason: "",
        purpose: "game-on-card",
        events: [{
          id: "updated-card-event",
          type: "game",
          date: "2026-10-03",
          time: "09:30",
          location: "North Field",
          opponent: "Ravens",
          snacks: "",
          drinks: "",
          notes: "",
        }],
      }),
    });
    assert.equal(cardUpdateResponse.status, 200);

    const otherOwnerUpdateResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/schedule-shares/${gameShare.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-test-user": otherOwnerId },
        body: JSON.stringify({
          title: "Unauthorized card update",
          teamSeason: "",
          purpose: "game-on-card",
          events: [{
            id: "unauthorized-card-event",
            type: "game",
            date: "2026-10-03",
            time: "09:30",
            location: "North Field",
            opponent: "Ravens",
            snacks: "",
            drinks: "",
            notes: "",
          }],
        }),
      },
    );
    assert.equal(otherOwnerUpdateResponse.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (insertedIds.length) {
      await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, insertedIds[0]!));
      for (const id of insertedIds.slice(1)) {
        await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, id));
      }
    }
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherOwnerId));
  }
});

test("public practice Game On Card links shared prep and Hype Page but never game stats", async () => {
  const ownerId = `practice-card-owner-${crypto.randomUUID()}`;
  const eventId = `practice-card-event-${crypto.randomUUID()}`;
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
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const createShareResponse = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        title: "Tigers practice",
        teamSeason: "Fall 2026",
        purpose: "game-on-card",
        events: [{
          id: eventId,
          type: "practice",
          status: "upcoming",
          date: "2026-10-03",
          time: "09:30",
          location: "North Field",
          opponent: "Ravens",
          snacks: "PRIVATE PRACTICE SNACKS",
          drinks: "PRIVATE PRACTICE DRINKS",
          notes: "PRIVATE PRACTICE NOTES",
        }],
      }),
    });
    assert.equal(createShareResponse.status, 201);
    const scheduleShare = CreateScheduleShareResponse.parse(await createShareResponse.json());
    assert.equal(scheduleShare.teamSeason, "");
    shareId = scheduleShare.shareToken;

    const checklistResponse = await fetch(`http://127.0.0.1:${address.port}/api/checklist-shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        title: "Practice prep",
        mode: "gameday",
        items: [{ id: "water", label: "Bring water", completed: false, section: "Before leaving" }],
        selectedGame: {
          id: eventId,
          type: "practice",
          date: "2026-10-03",
          time: "09:30",
          location: "North Field",
          opponent: "Ravens",
        },
      }),
    });
    assert.equal(checklistResponse.status, 201);
    const checklist = CreateChecklistShareResponse.parse(await checklistResponse.json());
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

    const response = await fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/${shareId}`);
    assert.equal(response.status, 200);
    const card = GetGameOnCardResponse.parse(await response.json());
    assert.equal(card.event.type, "practice");
    assert.equal(card.stage, "upcoming");
    assert.equal(card.prepState, "shared");
    assert.equal(card.prepShareToken, checklist.shareToken);
    assert.equal(card.statsState, "not-shared");
    assert.equal("statsShareToken" in card, false);
    assert.equal("statsUpdatedAt" in card, false);
    assert.equal(card.athletePageState, "published");
    assert.equal(card.athleteName, "Alex Tiger");
    assert.ok(card.athletePageToken);
    const publicJson = JSON.stringify(card);
    assert.doesNotMatch(publicJson, /PRIVATE PRACTICE (SNACKS|DRINKS|NOTES)/);
    assert.doesNotMatch(publicJson, new RegExp(trackerShare.id));
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

test("deleting a Game On Card removes only its uniquely linked Calendar event owned by the caller", async () => {
  const ownerId = `delete-game-on-owner-${crypto.randomUUID()}`;
  const otherOwnerId = `delete-game-on-other-${crypto.randomUUID()}`;
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
  const server = app.listen(0);
  const projectIds: string[] = [];
  const shareIds: string[] = [];

  const event = (id: string) => ({
    id,
    type: "game",
    date: "2026-10-03",
    time: "09:30",
    location: "North Field",
    opponent: "Ravens",
  });
  const createProject = async (ownerClerkUserId: string, eventId: string, duplicateEvent = false) => {
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId,
      name: "Fall Calendar",
      project: {
        tool: "schedule",
        teamName: "Tigers",
        events: [event(eventId), ...(duplicateEvent ? [event(eventId)] : [])],
      },
    }).returning({ id: cloudProjectsTable.id });
    projectIds.push(project!.id);
    return project!.id;
  };
  const createCard = async (eventId: string, calendarProjectId?: string) => {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        title: "Tigers",
        teamSeason: "Fall 2026",
        purpose: "game-on-card",
        ...(calendarProjectId ? { calendarProjectId } : {}),
        events: [{
          ...event(eventId),
          snacks: "",
          drinks: "",
          notes: "",
        }],
      }),
    });
    const responseText = await response.text();
    assert.equal(response.status, 201, responseText);
    const share = JSON.parse(responseText) as { shareToken: string };
    shareIds.push(share.shareToken);
    return share.shareToken;
  };
  const deleteCard = async (shareToken: string) => {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return fetch(`http://127.0.0.1:${address.port}/api/game-on-cards/owned/${shareToken}`, {
      method: "DELETE",
      headers: { "x-test-user": ownerId },
    });
  };

  try {
    const matchingEventId = `matching-${crypto.randomUUID()}`;
    const matchingProjectId = await createProject(ownerId, matchingEventId);
    const matchingShareId = await createCard(matchingEventId, matchingProjectId);
    const [linkedShare] = await db.select().from(scheduleSharesTable)
      .where(eq(scheduleSharesTable.id, matchingShareId));
    assert.equal(linkedShare!.calendarProjectId, matchingProjectId);
    assert.equal(linkedShare!.calendarEventId, matchingEventId);
    assert.equal(linkedShare!.calendarOwnerClerkUserId, ownerId);
    const matchingResponse = await deleteCard(matchingShareId);
    assert.equal(matchingResponse.status, 200);
    const matchingResult = await matchingResponse.json() as {
      calendarEventDeleted: boolean;
      calendarEventStatus: string;
    };
    assert.deepEqual(matchingResult, { calendarEventDeleted: true, calendarEventStatus: "deleted" });
    const [matchingProject] = await db.select().from(cloudProjectsTable)
      .where(eq(cloudProjectsTable.id, matchingProjectId));
    assert.deepEqual((matchingProject!.project as { events: unknown[] }).events, []);
    assert.equal((await db.select().from(scheduleSharesTable)
      .where(eq(scheduleSharesTable.id, matchingShareId))).length, 0);

    const unassociatedEventId = `unassociated-${crypto.randomUUID()}`;
    const unassociatedProjectId = await createProject(ownerId, unassociatedEventId);
    const unassociatedShareId = await createCard(unassociatedEventId);
    const unassociatedResponse = await deleteCard(unassociatedShareId);
    assert.equal(unassociatedResponse.status, 200);
    assert.deepEqual(await unassociatedResponse.json(), {
      calendarEventDeleted: false,
      calendarEventStatus: "not-linked",
    });
    const [unassociatedProject] = await db.select().from(cloudProjectsTable)
      .where(eq(cloudProjectsTable.id, unassociatedProjectId));
    assert.equal((unassociatedProject!.project as { events: unknown[] }).events.length, 1);

    const foreignEventId = `foreign-${crypto.randomUUID()}`;
    const foreignProjectId = await createProject(otherOwnerId, foreignEventId);
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const rejectedLinkResponse = await fetch(`http://127.0.0.1:${address.port}/api/schedule-shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": ownerId },
      body: JSON.stringify({
        title: "Tigers",
        teamSeason: "Fall 2026",
        purpose: "game-on-card",
        calendarProjectId: foreignProjectId,
        events: [{ ...event(foreignEventId), snacks: "", drinks: "", notes: "" }],
      }),
    });
    assert.equal(rejectedLinkResponse.status, 400);
    const [wrongOwnerShare] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Tigers",
      teamSeason: GAME_ON_CARD_MARKER,
      events: [event(foreignEventId)],
      calendarProjectId: foreignProjectId,
      calendarEventId: foreignEventId,
      calendarOwnerClerkUserId: ownerId,
    }).returning({ id: scheduleSharesTable.id });
    const wrongOwnerShareId = wrongOwnerShare!.id;
    shareIds.push(wrongOwnerShareId);
    const wrongOwnerResponse = await deleteCard(wrongOwnerShareId);
    assert.equal(wrongOwnerResponse.status, 200);
    assert.deepEqual(await wrongOwnerResponse.json(), {
      calendarEventDeleted: false,
      calendarEventStatus: "unverified",
    });
    const [foreignProject] = await db.select().from(cloudProjectsTable)
      .where(eq(cloudProjectsTable.id, foreignProjectId));
    assert.equal((foreignProject!.project as { events: unknown[] }).events.length, 1);

    const ambiguousEventId = `ambiguous-${crypto.randomUUID()}`;
    const ambiguousProjectId = await createProject(ownerId, ambiguousEventId, true);
    const [ambiguousShare] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Tigers",
      teamSeason: GAME_ON_CARD_MARKER,
      events: [event(ambiguousEventId)],
      calendarProjectId: ambiguousProjectId,
      calendarEventId: ambiguousEventId,
      calendarOwnerClerkUserId: ownerId,
    }).returning({ id: scheduleSharesTable.id });
    const ambiguousShareId = ambiguousShare!.id;
    shareIds.push(ambiguousShareId);
    const ambiguousResponse = await deleteCard(ambiguousShareId);
    assert.equal(ambiguousResponse.status, 200);
    assert.deepEqual(await ambiguousResponse.json(), {
      calendarEventDeleted: false,
      calendarEventStatus: "ambiguous",
    });
    const [ambiguousProject] = await db.select().from(cloudProjectsTable)
      .where(eq(cloudProjectsTable.id, ambiguousProjectId));
    assert.equal((ambiguousProject!.project as { events: unknown[] }).events.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    for (const id of shareIds) {
      await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, id));
    }
    for (const id of projectIds) {
      await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, id));
    }
  }
});