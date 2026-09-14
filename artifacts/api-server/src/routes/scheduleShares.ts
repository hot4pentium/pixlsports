import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateScheduleShareBody,
  CreateScheduleShareResponse,
  UpdateScheduleShareBody,
  UpdateScheduleShareResponse,
  GetScheduleShareParams,
} from "@workspace/api-zod";
import { db, scheduleSharesTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";

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

  res.json(shareResponse(share));
});

export default router;