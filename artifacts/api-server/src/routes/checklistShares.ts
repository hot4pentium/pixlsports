import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  CreateChecklistShareBody,
  CreateChecklistShareResponse,
  GetChecklistShareParams,
  UpdateChecklistShareBody,
  UpdateChecklistShareResponse,
} from "@workspace/api-zod";
import { checklistSharesTable, db } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isAccountActive } from "../lib/accountLifecycle";

const router: IRouter = Router();

function shareResponse(share: typeof checklistSharesTable.$inferSelect, canManage = false) {
  return CreateChecklistShareResponse.parse({
    shareToken: share.id,
    title: share.title,
    mode: share.mode,
    items: share.items,
    selectedGame: share.selectedGame,
    revision: share.revision,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    canManage,
  });
}

async function findActiveShare(shareToken: string) {
  const [share] = await db.select().from(checklistSharesTable).where(eq(checklistSharesTable.id, shareToken));
  if (!share || !(await isAccountActive(share.ownerClerkUserId))) return null;
  return share;
}

router.post("/checklist-shares", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateChecklistShareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [created] = await db.insert(checklistSharesTable).values({
      ownerClerkUserId: getRequiredClerkUserId(res),
      title: parsed.data.title,
      mode: parsed.data.mode,
      items: parsed.data.items,
      selectedGame: parsed.data.selectedGame ?? null,
    }).returning();
    res.status(201).json(shareResponse(created, true));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create checklist share");
    res.status(500).json({ error: "Unable to create checklist share" });
  }
});

router.get("/checklist-shares/:shareToken", async (req, res): Promise<void> => {
  const params = GetChecklistShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Checklist share not found" });
    return;
  }
  const share = await findActiveShare(params.data.shareToken);
  if (!share) {
    res.status(404).json({ error: "Checklist share not found" });
    return;
  }
  res.json(shareResponse(share, getAuth(req)?.userId === share.ownerClerkUserId));
});

router.patch("/checklist-shares/:shareToken", async (req, res): Promise<void> => {
  const params = GetChecklistShareParams.safeParse(req.params);
  const parsed = UpdateChecklistShareBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid checklist update request" });
    return;
  }
  try {
    const current = await findActiveShare(params.data.shareToken);
    if (!current) {
      res.status(404).json({ error: "Checklist share not found" });
      return;
    }
    if (current.revision !== parsed.data.expectedRevision) {
      res.status(409).json({
        error: "Checklist revision is stale",
        current: shareResponse(current, getAuth(req)?.userId === current.ownerClerkUserId),
      });
      return;
    }
    const [updated] = await db.update(checklistSharesTable).set({
      title: parsed.data.title,
      mode: parsed.data.mode,
      items: parsed.data.items,
      selectedGame: parsed.data.selectedGame ?? null,
      revision: sql`${checklistSharesTable.revision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(checklistSharesTable.id, params.data.shareToken),
      eq(checklistSharesTable.revision, parsed.data.expectedRevision),
    )).returning();
    if (!updated) {
      const latest = await findActiveShare(params.data.shareToken);
      if (!latest) {
        res.status(404).json({ error: "Checklist share not found" });
        return;
      }
      res.status(409).json({
        error: "Checklist revision is stale",
        current: shareResponse(latest, getAuth(req)?.userId === latest.ownerClerkUserId),
      });
      return;
    }
    res.json(UpdateChecklistShareResponse.parse(shareResponse(updated, getAuth(req)?.userId === updated.ownerClerkUserId)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to update checklist share");
    res.status(500).json({ error: "Unable to update checklist share" });
  }
});

router.delete("/checklist-shares/:shareToken", requireAuth, async (req, res): Promise<void> => {
  const params = GetChecklistShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Checklist share not found" });
    return;
  }
  const [deleted] = await db.delete(checklistSharesTable).where(and(
    eq(checklistSharesTable.id, params.data.shareToken),
    eq(checklistSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  )).returning({ id: checklistSharesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Checklist share not found" });
    return;
  }
  res.status(204).send();
});

export default router;