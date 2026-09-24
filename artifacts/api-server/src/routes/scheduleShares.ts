import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateScheduleShareBody,
  CreateScheduleShareResponse,
  GetGameOnCardParams,
  GetGameOnCardResponse,
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

const router: IRouter = Router();

function shareResponse(share: typeof scheduleSharesTable.$inferSelect) {
  return CreateScheduleShareResponse.parse({
    shareToken: share.id,
    title: share.title,
    teamSeason: share.teamSeason,
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

  try {
    const [created] = await db
      .insert(scheduleSharesTable)
      .values({
        ownerClerkUserId: getRequiredClerkUserId(res),
        title: parsed.data.title,
        teamSeason: parsed.data.teamSeason,
        events: parsed.data.events,
      })
      .returning();
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

  try {
    const [updated] = await db
      .update(scheduleSharesTable)
      .set({
        title: parsed.data.title,
        teamSeason: parsed.data.teamSeason,
        events: parsed.data.events,
        updatedAt: new Date(),
      })
      .where(and(
        eq(scheduleSharesTable.id, params.data.shareToken),
        eq(scheduleSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
      ))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Schedule share not found" });
      return;
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

  const [share] = await db
    .select()
    .from(scheduleSharesTable)
    .where(eq(scheduleSharesTable.id, params.data.shareToken));
  if (!share) {
    res.status(404).json({ error: "Schedule share not found" });
    return;
  }
  if (!(await isAccountActive(share.ownerClerkUserId))) {
    res.status(404).json({ error: "Schedule share not found" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(shareResponse(share));
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
    if (!share || !(await isAccountActive(share.ownerClerkUserId))) {
      res.status(404).json({ error: "Game On Card not found" });
      return;
    }

    const storedShare = shareResponse(share);
    if (storedShare.events.length !== 1 || storedShare.events[0]?.type !== "game") {
      res.status(404).json({ error: "Game On Card not found" });
      return;
    }

    const sourceEvent = storedShare.events[0];
    const eventStatus = sourceEvent.status ?? "upcoming";
    const now = new Date();
    const [checklistShare, activeStatTrackerShare, latestStatTrackerShare, athletePage] = await Promise.all([
      db.select({ id: checklistSharesTable.id })
        .from(checklistSharesTable)
        .where(and(
          eq(checklistSharesTable.ownerClerkUserId, share.ownerClerkUserId),
          sql`${checklistSharesTable.selectedGame}->>'id' = ${sourceEvent.id}`,
        ))
        .orderBy(desc(checklistSharesTable.updatedAt))
        .limit(1)
        .then(([row]) => row),
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

    const statTrackerShare = activeStatTrackerShare ?? latestStatTrackerShare;
    const sharedGame = statTrackerShare?.game as Record<string, unknown> | undefined;
    const trackedStage = sharedGame?.status === "final" || sharedGame?.status === "live"
      ? sharedGame.status
      : undefined;
    const statsState = !statTrackerShare
      ? "not-shared"
      : !activeStatTrackerShare
        ? "expired"
        : trackedStage ?? "not-shared";
    const stage = trackedStage ?? eventStatus;

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
        type: "game",
        status: eventStatus,
        date: sourceEvent.date,
        time: sourceEvent.time,
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