import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateScheduleShareBody,
  CreateScheduleShareResponse,
  GetGameOnCardParams,
  GetGameOnCardResponse,
  ListOwnedGameOnCardsResponse,
  UpdateScheduleShareBody,
  UpdateScheduleShareResponse,
  GetScheduleShareParams,
} from "@workspace/api-zod";
import {
  athleteInvitesTable,
  checklistSharesTable,
  db,
  scheduleSharesTable,
  statTrackerSharesTable,
} from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isAccountActive } from "../lib/accountLifecycle";
import { isIanaTimezone } from "../lib/timezone";
import { reconcileGameOnShare } from "../jobs/gameOnReminderQueue";

const router: IRouter = Router();
// Stored in an existing non-card metadata field until the card has its own durable model.
// Never return this internal value in a public or owned share response.
export const GAME_ON_CARD_MARKER = "@pixlsports:game-on-card:v1";

function isSingleCardEvent(events: unknown) {
  if (!Array.isArray(events) || events.length !== 1) return false;
  const event: unknown = events[0];
  return Boolean(event && typeof event === "object" && "type" in event
    && (event.type === "game" || event.type === "practice"));
}

function hasValidEventTimezone(events: unknown) {
  if (!Array.isArray(events) || events.length !== 1) return false;
  const event: unknown = events[0];
  return Boolean(event && typeof event === "object"
    && (!("timezone" in event) || isIanaTimezone(event.timezone)));
}

function shareResponse(share: typeof scheduleSharesTable.$inferSelect) {
  return CreateScheduleShareResponse.parse({
    shareToken: share.id,
    title: share.title,
    teamSeason: share.teamSeason === GAME_ON_CARD_MARKER ? "" : share.teamSeason,
    events: share.events,
    createdAt: share.createdAt,
  });
}

router.post("/schedule-shares", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateScheduleShareBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid schedule share request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.purpose === "game-on-card" && !isSingleCardEvent(parsed.data.events)) {
    res.status(400).json({ error: "A Game On Card must contain one game or practice" });
    return;
  }
  if (parsed.data.purpose === "game-on-card" && !hasValidEventTimezone(parsed.data.events)) {
    res.status(400).json({ error: "Choose a valid event time zone." });
    return;
  }
  if (parsed.data.purpose !== "game-on-card") {
    res.status(410).json({ error: "Standalone Calendar sharing is no longer supported." });
    return;
  }

  try {
    const [created] = await db
      .insert(scheduleSharesTable)
      .values({
        ownerClerkUserId: getRequiredClerkUserId(res),
        title: parsed.data.title,
        teamSeason: parsed.data.purpose === "game-on-card" ? GAME_ON_CARD_MARKER : parsed.data.teamSeason,
        events: parsed.data.events,
      })
      .returning();
    try {
      await reconcileGameOnShare(created);
    } catch {
      // A bounded background sweep will retry reconciliation. The card save
      // itself succeeded; do not misreport it as a failed save to the owner.
      req.log.warn("Game On card saved; reminder scheduling needs reconciliation");
    }
    res.status(201).json(shareResponse(created));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create schedule share");
    res.status(500).json({ error: "Unable to create schedule share" });
  }
});

router.patch("/schedule-shares/:shareToken", requireAuth, async (req, res): Promise<void> => {
  const params = GetScheduleShareParams.safeParse(req.params);
  const parsed = UpdateScheduleShareBody.safeParse(req.body);
  if (!params.success) {
    req.log.warn({ errors: params.error.issues }, "Invalid schedule share update request");
    res.status(400).json({ error: "Invalid schedule share update request" });
    return;
  }
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid schedule share update request");
    res.status(400).json({ error: "Invalid schedule share update request" });
    return;
  }
  if (parsed.data.purpose === "game-on-card" && !isSingleCardEvent(parsed.data.events)) {
    res.status(400).json({ error: "A Game On Card must contain one game or practice" });
    return;
  }
  if (parsed.data.purpose === "game-on-card" && !hasValidEventTimezone(parsed.data.events)) {
    res.status(400).json({ error: "Choose a valid event time zone." });
    return;
  }

  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const [current] = await db
      .select()
      .from(scheduleSharesTable)
      .where(and(
        eq(scheduleSharesTable.id, params.data.shareToken),
        eq(scheduleSharesTable.ownerClerkUserId, ownerClerkUserId),
      ));
    if (!current) {
      res.status(404).json({ error: "Schedule share not found" });
      return;
    }
    if (current.teamSeason !== GAME_ON_CARD_MARKER || parsed.data.purpose !== "game-on-card") {
      res.status(410).json({ error: "Standalone Calendar sharing is no longer supported." });
      return;
    }

    const [updated] = await db
      .update(scheduleSharesTable)
      .set({
        title: parsed.data.title,
        teamSeason: parsed.data.purpose === "game-on-card" ? GAME_ON_CARD_MARKER : parsed.data.teamSeason,
        events: parsed.data.events,
        updatedAt: new Date(),
      })
      .where(and(
        eq(scheduleSharesTable.id, params.data.shareToken),
        eq(scheduleSharesTable.ownerClerkUserId, ownerClerkUserId),
      ))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Schedule share not found" });
      return;
    }

    try {
      await reconcileGameOnShare(updated);
    } catch {
      req.log.warn("Game On card updated; reminder scheduling needs reconciliation");
    }
    res.json(UpdateScheduleShareResponse.parse(shareResponse(updated)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to update schedule share");
    res.status(500).json({ error: "Unable to update schedule share" });
  }
});

router.delete("/schedule-shares/:shareToken", requireAuth, async (req, res): Promise<void> => {
  const params = GetScheduleShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Schedule share not found" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(scheduleSharesTable)
      .where(and(
        eq(scheduleSharesTable.id, params.data.shareToken),
        eq(scheduleSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
      ))
      .returning({ id: scheduleSharesTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Schedule share not found" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    req.log.error({ err: error }, "Unable to revoke schedule share");
    res.status(500).json({ error: "Unable to revoke schedule share" });
  }
});

router.get("/schedule-shares/:shareToken", async (req, res): Promise<void> => {
  const params = GetScheduleShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Schedule share not found" });
    return;
  }

  // Public snapshots were standalone Calendar links. Game On Cards have a
  // dedicated, privacy-filtered route and must never fall back to this payload.
  res.status(404).json({ error: "Schedule share not found" });
});

router.get("/game-on-cards/owned", requireAuth, async (req, res): Promise<void> => {
  try {
    const shares = await db
      .select()
      .from(scheduleSharesTable)
      .where(eq(scheduleSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)))
      .orderBy(desc(scheduleSharesTable.createdAt));
    const cards = shares
      .filter((share) => share.teamSeason === GAME_ON_CARD_MARKER && isSingleCardEvent(share.events))
      .map(shareResponse);
    res.json(ListOwnedGameOnCardsResponse.parse(cards));
  } catch (error) {
    req.log.error({ err: error }, "Unable to list owned Game On Cards");
    res.status(500).json({ error: "Unable to list owned Game On Cards" });
  }
});

router.get("/game-on-cards/:shareToken", async (req, res): Promise<void> => {
  const params = GetGameOnCardParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Game On Card not found" });
    return;
  }

  try {
    const [share] = await db
      .select()
      .from(scheduleSharesTable)
      .where(eq(scheduleSharesTable.id, params.data.shareToken));
    if (!share
      || (share.teamSeason !== GAME_ON_CARD_MARKER && !isSingleCardEvent(share.events))
      || !(await isAccountActive(share.ownerClerkUserId))) {
      res.status(404).json({ error: "Game On Card not found" });
      return;
    }

    const storedShare = shareResponse(share);
    if (storedShare.events.length !== 1
      || (storedShare.events[0]?.type !== "game" && storedShare.events[0]?.type !== "practice")) {
      res.status(404).json({ error: "Game On Card not found" });
      return;
    }

    const sourceEvent = storedShare.events[0];
    const eventStatus = sourceEvent.status ?? "upcoming";
    const now = new Date();
    const [checklistShare, trackerShares, athletePage] = await Promise.all([
      db.select({ id: checklistSharesTable.id })
        .from(checklistSharesTable)
        .where(and(
          eq(checklistSharesTable.ownerClerkUserId, share.ownerClerkUserId),
          sql`${checklistSharesTable.selectedGame}->>'id' = ${sourceEvent.id}`,
        ))
        .orderBy(desc(checklistSharesTable.updatedAt))
        .limit(1)
        .then(([row]) => row),
      sourceEvent.type === "game"
        ? Promise.all([
          db.select()
            .from(statTrackerSharesTable)
            .where(and(
              eq(statTrackerSharesTable.ownerClerkUserId, share.ownerClerkUserId),
              eq(statTrackerSharesTable.gameId, sourceEvent.id),
              gt(statTrackerSharesTable.expiresAt, now),
            ))
            .orderBy(desc(statTrackerSharesTable.updatedAt))
            .limit(1)
            .then(([row]) => row),
          db.select()
            .from(statTrackerSharesTable)
            .where(and(
              eq(statTrackerSharesTable.ownerClerkUserId, share.ownerClerkUserId),
              eq(statTrackerSharesTable.gameId, sourceEvent.id),
            ))
            .orderBy(desc(statTrackerSharesTable.updatedAt))
            .limit(1)
            .then(([row]) => row),
        ]).then(([active, latest]) => ({ active, latest }))
        : Promise.resolve({ active: undefined, latest: undefined }),
      db.select({
        publicToken: athleteInvitesTable.publicToken,
        athleteName: athleteInvitesTable.athleteName,
        paused: athleteInvitesTable.paused,
      })
        .from(athleteInvitesTable)
        .where(eq(athleteInvitesTable.ownerClerkUserId, share.ownerClerkUserId))
        .limit(1)
        .then(([row]) => row),
    ]);

    const activeStatTrackerShare = trackerShares.active;
    const latestStatTrackerShare = trackerShares.latest;
    const statTrackerShare = activeStatTrackerShare ?? latestStatTrackerShare;
    const sharedGame = statTrackerShare?.game as Record<string, unknown> | undefined;
    const trackedStage = sharedGame?.status === "final" || sharedGame?.status === "live"
      ? sharedGame.status
      : undefined;
    const statsState = sourceEvent.type !== "game" || !statTrackerShare
      ? "not-shared"
      : !activeStatTrackerShare
        ? "expired"
        : trackedStage ?? "not-shared";
    const stage = sourceEvent.type === "game" ? trackedStage ?? eventStatus : eventStatus;

    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.json(GetGameOnCardResponse.parse({
      shareToken: share.id,
      title: storedShare.title,
      teamSeason: storedShare.teamSeason,
      event: {
        id: sourceEvent.id,
        type: sourceEvent.type,
        status: eventStatus,
        date: sourceEvent.date,
        time: sourceEvent.time,
        ...(sourceEvent.timezone ? { timezone: sourceEvent.timezone } : {}),
        location: sourceEvent.location,
        opponent: sourceEvent.opponent,
      },
      stage,
      prepState: checklistShare ? "shared" : "private",
      ...(checklistShare ? { prepShareToken: checklistShare.id } : {}),
      statsState,
      ...(activeStatTrackerShare && trackedStage
        ? {
          statsShareToken: activeStatTrackerShare.id,
          statsUpdatedAt: activeStatTrackerShare.updatedAt.toISOString(),
        }
        : {}),
      athletePageState: !athletePage ? "unpublished" : athletePage.paused ? "paused" : "published",
      ...(athletePage && !athletePage.paused
        ? {
          athletePageToken: athletePage.publicToken,
          athleteName: athletePage.athleteName,
        }
        : {}),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load Game On Card");
    res.status(500).json({ error: "Unable to load Game On Card" });
  }
});

export default router;