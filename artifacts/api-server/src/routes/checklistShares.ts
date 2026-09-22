import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
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

const checklistSubscribers = new Map<string, Set<Response>>();

function shareResponse(share: typeof checklistSharesTable.$inferSelect, canManage = false) {
  return CreateChecklistShareResponse.parse({
    shareToken: share.id,
    title: share.title,
    notes: share.notes,
    mode: share.mode,
    items: share.items,
    selectedGame: share.selectedGame,
    revision: share.revision,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    canManage,
  });
}

function writeChecklistEvent(res: Response, event: string, payload: unknown, revision?: number) {
  if (revision !== undefined) res.write(`id: ${revision}\n`);
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcastChecklistEvent(shareToken: string, event: string, payload: unknown, revision?: number) {
  const subscribers = checklistSubscribers.get(shareToken);
  if (!subscribers) return;
  for (const res of subscribers) {
    if (res.writableEnded) {
      subscribers.delete(res);
      continue;
    }
    try {
      writeChecklistEvent(res, event, payload, revision);
    } catch {
      subscribers.delete(res);
      res.end();
    }
  }
  if (subscribers.size === 0) checklistSubscribers.delete(shareToken);
}

async function findActiveShare(shareToken: string) {
  const [share] = await db.select().from(checklistSharesTable).where(eq(checklistSharesTable.id, shareToken));
  if (!share || !(await isAccountActive(share.ownerClerkUserId))) return null;
  return share;
}

router.get("/checklist-shares/:shareToken/events", async (req, res): Promise<void> => {
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

  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 1000\n\n");

  const subscribers = checklistSubscribers.get(params.data.shareToken) ?? new Set<Response>();
  subscribers.add(res);
  checklistSubscribers.set(params.data.shareToken, subscribers);

  let heartbeat: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    subscribers.delete(res);
    if (subscribers.size === 0) checklistSubscribers.delete(params.data.shareToken);
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
  heartbeat = setInterval(() => {
    if (res.writableEnded) {
      cleanup();
      return;
    }
    try {
      res.write(": keep-alive\n\n");
    } catch {
      cleanup();
      res.end();
    }
  }, 20000);

  writeChecklistEvent(res, "checklist", shareResponse(share), share.revision);
});

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
      notes: parsed.data.notes ?? "",
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
      notes: parsed.data.notes ?? "",
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
    const response = shareResponse(updated, getAuth(req)?.userId === updated.ownerClerkUserId);
    broadcastChecklistEvent(params.data.shareToken, "checklist", shareResponse(updated), updated.revision);
    res.json(UpdateChecklistShareResponse.parse(response));
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
  broadcastChecklistEvent(params.data.shareToken, "revoked", { shareToken: params.data.shareToken });
  res.status(204).send();
});

export default router;