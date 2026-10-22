import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  CreateStatTrackerShareBody,
  CreateStatTrackerShareResponse,
  GetStatTrackerShareParams,
  ListStatTrackerSharesResponse,
  UpdateStatTrackerShareBody,
  UpdateStatTrackerShareResponse,
} from "@workspace/api-zod";
import { athleteInvitesTable, db, statTrackerSharesTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isAccountActive } from "../lib/accountLifecycle";

const router: IRouter = Router();
const subscribers = new Map<string, Set<Response>>();

function isPairedPassEvent(event: Record<string, unknown>) {
  return typeof event.playId === "string"
    && (event.statId === "pass-yard" || event.statId === "reception");
}

export function getPublicEvents(storedEvents: unknown[]) {
  const firstVisibleIndex = Math.max(0, storedEvents.length - 10);
  const visibleEvents = storedEvents.slice(firstVisibleIndex);
  const boundaryPlayIds = new Set(
    visibleEvents
      .filter((event): event is Record<string, unknown> => typeof event === "object" && event !== null && isPairedPassEvent(event as Record<string, unknown>))
      .map((event) => event.playId as string)
      .filter((playId) => storedEvents
        .slice(0, firstVisibleIndex)
        .some((event) => (
          typeof event === "object"
          && event !== null
          && (event as Record<string, unknown>).playId === playId
          && isPairedPassEvent(event as Record<string, unknown>)
        ))),
  );
  if (!boundaryPlayIds.size) return visibleEvents;

  const requiredEvents = new Set(
    storedEvents.filter((event): event is Record<string, unknown> => (
      typeof event === "object"
      && event !== null
      && typeof (event as Record<string, unknown>).playId === "string"
      && boundaryPlayIds.has((event as Record<string, unknown>).playId as string)
    )),
  );
  const expandedEvents = storedEvents.slice(Math.max(0, firstVisibleIndex - boundaryPlayIds.size));
  while (expandedEvents.length > 10) {
    const removableIndex = expandedEvents.findIndex((event) => (
      typeof event !== "object" || event === null || !requiredEvents.has(event as Record<string, unknown>)
    ));
    if (removableIndex < 0) break;
    expandedEvents.splice(removableIndex, 1);
  }
  return expandedEvents;
}

function publicResponse(
  share: typeof statTrackerSharesTable.$inferSelect,
  canManage = false,
  publicFanCardPath: string | null = null,
) {
  const storedGame = share.game as Record<string, unknown>;
  const storedEvents = Array.isArray(storedGame.events) ? storedGame.events : [];
  const game = {
    ...storedGame,
    events: getPublicEvents(storedEvents).map((event) => {
      const item = event as Record<string, unknown>;
      return {
        id: item.id,
        statId: item.statId,
        createdAt: item.createdAt,
        period: item.period,
        attribution: item.attribution === "athlete" ? "athlete" : "team",
        ...(typeof item.playId === "string" ? { playId: item.playId } : {}),
        yards: typeof item.yards === "number" ? item.yards : null,
      };
    }),
  };
  return CreateStatTrackerShareResponse.parse({
    shareToken: share.id,
    athleteName: share.athleteName,
    teamName: share.teamName,
    game,
    revision: share.revision,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    expiresAt: share.expiresAt,
    canManage,
    publicFanCardPath,
  });
}

function normalizePublicIdentity(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function getPublicFanCardPath(share: typeof statTrackerSharesTable.$inferSelect) {
  const game = share.game as Record<string, unknown>;
  if (game.status !== "final") return null;

  const [invite] = await db.select({
    publicToken: athleteInvitesTable.publicToken,
    athleteName: athleteInvitesTable.athleteName,
    teamName: athleteInvitesTable.teamName,
    sport: athleteInvitesTable.sport,
    showHypeCard: athleteInvitesTable.showHypeCard,
    paused: athleteInvitesTable.paused,
  }).from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.ownerClerkUserId, share.ownerClerkUserId))
    .limit(1);

  if (!invite || invite.paused || !invite.showHypeCard) return null;
  if (normalizePublicIdentity(invite.athleteName) !== normalizePublicIdentity(share.athleteName)) return null;
  if (normalizePublicIdentity(invite.sport) !== normalizePublicIdentity(game.sport)) return null;

  const shareTeamName = normalizePublicIdentity(share.teamName);
  const inviteTeamName = normalizePublicIdentity(invite.teamName);
  if (shareTeamName !== inviteTeamName) return null;

  return `/fan/${encodeURIComponent(invite.publicToken)}`;
}

function writeEvent(res: Response, event: string, payload: unknown, revision?: number) {
  if (revision !== undefined) res.write(`id: ${revision}\n`);
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(shareToken: string, event: string, payload: unknown, revision?: number) {
  const listeners = subscribers.get(shareToken);
  if (!listeners) return;
  for (const res of listeners) {
    if (res.writableEnded) {
      listeners.delete(res);
      continue;
    }
    try {
      writeEvent(res, event, payload, revision);
    } catch {
      listeners.delete(res);
      res.end();
    }
  }
  if (!listeners.size) subscribers.delete(shareToken);
}

async function findActiveShare(shareToken: string) {
  const [share] = await db.select().from(statTrackerSharesTable).where(and(
    eq(statTrackerSharesTable.id, shareToken),
    gt(statTrackerSharesTable.expiresAt, new Date()),
  ));
  if (!share || !(await isAccountActive(share.ownerClerkUserId))) return null;
  return share;
}

router.get("/stat-tracker-shares/:shareToken/events", async (req, res): Promise<void> => {
  const params = GetStatTrackerShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Stat tracker share not found" });
    return;
  }
  const share = await findActiveShare(params.data.shareToken);
  if (!share) {
    res.status(404).json({ error: "Stat tracker share not found" });
    return;
  }
  const publicFanCardPath = await getPublicFanCardPath(share);

  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 1000\n\n");
  const listeners = subscribers.get(params.data.shareToken) ?? new Set<Response>();
  listeners.add(res);
  subscribers.set(params.data.shareToken, listeners);
  let heartbeat: NodeJS.Timeout | undefined;
  let heartbeatChecking = false;
  const revokeUnavailable = (reason: "expired" | "unavailable") => {
    if (res.writableEnded) return;
    writeEvent(res, "revoked", { shareToken: params.data.shareToken, reason });
    cleanup();
    res.end();
  };
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    listeners.delete(res);
    if (!listeners.size) subscribers.delete(params.data.shareToken);
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
  heartbeat = setInterval(async () => {
    if (heartbeatChecking) return;
    heartbeatChecking = true;
    if (res.writableEnded) {
      cleanup();
      heartbeatChecking = false;
      return;
    }
    try {
      const current = await findActiveShare(params.data.shareToken);
      if (!current) {
        const [stored] = await db.select({
          expiresAt: statTrackerSharesTable.expiresAt,
        }).from(statTrackerSharesTable).where(eq(statTrackerSharesTable.id, params.data.shareToken));
        revokeUnavailable(stored && stored.expiresAt <= new Date() ? "expired" : "unavailable");
        return;
      }
      res.write(": keep-alive\n\n");
    } catch {
      cleanup();
      res.end();
    } finally {
      heartbeatChecking = false;
    }
  }, 20000);
  writeEvent(res, "stat-tracker", publicResponse(share, false, publicFanCardPath), share.revision);
});

router.get("/stat-tracker-shares", requireAuth, async (req, res): Promise<void> => {
  try {
    const ownerId = getRequiredClerkUserId(res);
    const shares = await db.select().from(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.ownerClerkUserId, ownerId),
      gt(statTrackerSharesTable.expiresAt, new Date()),
    )).orderBy(desc(statTrackerSharesTable.createdAt));
    const responses = await Promise.all(shares.map(async (share) => (
      publicResponse(share, true, await getPublicFanCardPath(share))
    )));
    res.json(ListStatTrackerSharesResponse.parse(responses));
  } catch (error) {
    req.log.error({ err: error }, "Unable to list stat tracker shares");
    res.status(500).json({ error: "Unable to list stat tracker shares" });
  }
});

router.post("/stat-tracker-shares", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateStatTrackerShareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const gameId = parsed.data.game.id;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const created = await db.transaction(async (tx) => {
      const insertValues = {
        ownerClerkUserId,
        gameId,
        athleteName: parsed.data.athleteName,
        teamName: parsed.data.teamName,
        game: parsed.data.game,
        expiresAt,
      };
      const [inserted] = await tx.insert(statTrackerSharesTable)
        .values(insertValues)
        .onConflictDoNothing({
          target: [statTrackerSharesTable.ownerClerkUserId, statTrackerSharesTable.gameId],
        })
        .returning();
      if (inserted) return inserted;

      const [existing] = await tx.select().from(statTrackerSharesTable).where(and(
        eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
        eq(statTrackerSharesTable.gameId, gameId),
      ));
      if (existing && existing.expiresAt > new Date()) return existing;
      if (existing) {
        await tx.delete(statTrackerSharesTable).where(and(
          eq(statTrackerSharesTable.id, existing.id),
          lte(statTrackerSharesTable.expiresAt, new Date()),
        ));
      }
      const [replacement] = await tx.insert(statTrackerSharesTable)
        .values(insertValues)
        .onConflictDoNothing({
          target: [statTrackerSharesTable.ownerClerkUserId, statTrackerSharesTable.gameId],
        })
        .returning();
      if (replacement) return replacement;
      const [winner] = await tx.select().from(statTrackerSharesTable).where(and(
        eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
        eq(statTrackerSharesTable.gameId, gameId),
      ));
      return winner;
    });
    if (!created) {
      res.status(409).json({ error: "Unable to create stat tracker share" });
      return;
    }
    res.status(201).json(publicResponse(created, true, await getPublicFanCardPath(created)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create stat tracker share");
    res.status(500).json({ error: "Unable to create stat tracker share" });
  }
});

router.get("/stat-tracker-shares/:shareToken", async (req, res): Promise<void> => {
  const params = GetStatTrackerShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Stat tracker share not found" });
    return;
  }
  const share = await findActiveShare(params.data.shareToken);
  if (!share) {
    res.status(404).json({ error: "Stat tracker share not found" });
    return;
  }
  const publicFanCardPath = await getPublicFanCardPath(share);
  res.json(publicResponse(share, getAuth(req)?.userId === share.ownerClerkUserId, publicFanCardPath));
});

router.patch("/stat-tracker-shares/:shareToken", requireAuth, async (req, res): Promise<void> => {
  const params = GetStatTrackerShareParams.safeParse(req.params);
  const parsed = UpdateStatTrackerShareBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid stat tracker share update request" });
    return;
  }
  try {
    const ownerId = getRequiredClerkUserId(res);
    const current = await findActiveShare(params.data.shareToken);
    if (!current || current.ownerClerkUserId !== ownerId) {
      res.status(404).json({ error: "Stat tracker share not found" });
      return;
    }
    if (current.revision !== parsed.data.expectedRevision) {
      const publicFanCardPath = await getPublicFanCardPath(current);
      res.status(409).json({
        error: "Stat tracker share revision is stale",
        current: publicResponse(current, true, publicFanCardPath),
      });
      return;
    }
    const [updated] = await db.update(statTrackerSharesTable).set({
      gameId: parsed.data.game.id,
      athleteName: parsed.data.athleteName,
      teamName: parsed.data.teamName,
      game: parsed.data.game,
      revision: sql`${statTrackerSharesTable.revision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(statTrackerSharesTable.id, params.data.shareToken),
      eq(statTrackerSharesTable.ownerClerkUserId, ownerId),
      eq(statTrackerSharesTable.revision, parsed.data.expectedRevision),
    )).returning();
    if (!updated) {
      res.status(409).json({ error: "Stat tracker share revision is stale" });
      return;
    }
    const publicFanCardPath = await getPublicFanCardPath(updated);
    const response = publicResponse(updated, true, publicFanCardPath);
    broadcast(
      params.data.shareToken,
      "stat-tracker",
      publicResponse(updated, false, publicFanCardPath),
      updated.revision,
    );
    if (parsed.data.game.status === "final") {
      await db.update(athleteInvitesTable).set({
        liveTrackerShareToken: null,
        updatedAt: new Date(),
      }).where(and(
        eq(athleteInvitesTable.liveTrackerShareToken, params.data.shareToken),
        eq(athleteInvitesTable.ownerClerkUserId, ownerId),
      ));
    }
    res.json(UpdateStatTrackerShareResponse.parse(response));
  } catch (error) {
    req.log.error({ err: error }, "Unable to update stat tracker share");
    res.status(500).json({ error: "Unable to update stat tracker share" });
  }
});

router.delete("/stat-tracker-shares/:shareToken", requireAuth, async (req, res): Promise<void> => {
  const params = GetStatTrackerShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Stat tracker share not found" });
    return;
  }
  const [deleted] = await db.delete(statTrackerSharesTable).where(and(
    eq(statTrackerSharesTable.id, params.data.shareToken),
    eq(statTrackerSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  )).returning({ id: statTrackerSharesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Stat tracker share not found" });
    return;
  }
  broadcast(params.data.shareToken, "revoked", { shareToken: params.data.shareToken });
  res.status(204).send();
});

export default router;