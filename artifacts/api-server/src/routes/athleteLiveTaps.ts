import { createHash, randomBytes, randomUUID } from "crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAthleteInviteLiveTapAccessLinkParams,
  CreateAthleteInviteLiveTapAccessLinkResponse,
  ListAthleteInviteLiveTapAccessLinksParams,
  ListAthleteInviteLiveTapAccessLinksResponse,
  RevokeAthleteInviteLiveTapAccessLinkParams,
  SendAthleteLiveTapBody,
  SendAthleteLiveTapParams,
  SendAthleteLiveTapResponse,
} from "@workspace/api-zod";
import {
  athleteInviteLiveTapAccessLinksTable,
  athleteInviteLiveTapsTable,
  athleteInvitesTable,
  db,
  statTrackerSharesTable,
} from "@workspace/db";
import { isAccountActive } from "../lib/accountLifecycle";
import { getAthleteLiveTapsSummary, isLiveTapCheerForSport, visibleLiveTapSummary } from "../lib/athleteLiveTaps";
import { visibleLiveTapReceipt } from "../lib/liveTapGameRef";
import { getOptionalClerkUserId, getRequiredClerkUserId, requireAuth, requireAuthOrNativeOwner } from "../middlewares/requireAuth";

const router: IRouter = Router();
const LIVE_TAP_ACCESS_TOKEN_BYTES = 32;
const LIVE_TAP_RATE_WINDOW_MS = 60_000;
const LIVE_TAP_RATE_LIMIT = 120;

function hashAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

router.get("/athlete-invites/:inviteToken/live-taps/access-links", requireAuth, async (req, res): Promise<void> => {
  const params = ListAthleteInviteLiveTapAccessLinksParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  ));
  if (!invite) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  const links = await db.select({
    id: athleteInviteLiveTapAccessLinksTable.id,
    createdAt: athleteInviteLiveTapAccessLinksTable.createdAt,
  }).from(athleteInviteLiveTapAccessLinksTable).where(and(
    eq(athleteInviteLiveTapAccessLinksTable.inviteId, invite.id),
    isNull(athleteInviteLiveTapAccessLinksTable.revokedAt),
  )).orderBy(athleteInviteLiveTapAccessLinksTable.createdAt);
  res.json(ListAthleteInviteLiveTapAccessLinksResponse.parse(links));
});

router.post("/athlete-invites/:inviteToken/live-taps/access-links", requireAuth, async (req, res): Promise<void> => {
  const params = CreateAthleteInviteLiveTapAccessLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  ));
  if (!invite) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  const accessToken = randomBytes(LIVE_TAP_ACCESS_TOKEN_BYTES).toString("base64url");
  const [link] = await db.insert(athleteInviteLiveTapAccessLinksTable).values({
    inviteId: invite.id,
    tokenHash: hashAccessToken(accessToken),
  }).returning({
    id: athleteInviteLiveTapAccessLinksTable.id,
    createdAt: athleteInviteLiveTapAccessLinksTable.createdAt,
  });
  if (!link) {
    res.status(500).json({ error: "Unable to create a family Live Taps link." });
    return;
  }
  res.status(201).json(CreateAthleteInviteLiveTapAccessLinkResponse.parse({
    ...link,
    accessToken,
  }));
});

router.delete("/athlete-invites/:inviteToken/live-taps/access-links/:accessId", requireAuth, async (req, res): Promise<void> => {
  const params = RevokeAthleteInviteLiveTapAccessLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Live Taps link not found" });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  ));
  if (!invite) {
    res.status(404).json({ error: "Live Taps link not found" });
    return;
  }
  const [link] = await db.update(athleteInviteLiveTapAccessLinksTable).set({
    revokedAt: new Date(),
  }).where(and(
    eq(athleteInviteLiveTapAccessLinksTable.id, params.data.accessId),
    eq(athleteInviteLiveTapAccessLinksTable.inviteId, invite.id),
    isNull(athleteInviteLiveTapAccessLinksTable.revokedAt),
  )).returning({ id: athleteInviteLiveTapAccessLinksTable.id });
  if (!link) {
    const [existing] = await db.select({ id: athleteInviteLiveTapAccessLinksTable.id })
      .from(athleteInviteLiveTapAccessLinksTable).where(and(
        eq(athleteInviteLiveTapAccessLinksTable.id, params.data.accessId),
        eq(athleteInviteLiveTapAccessLinksTable.inviteId, invite.id),
      ));
    if (!existing) {
      res.status(404).json({ error: "Live Taps link not found" });
      return;
    }
  }
  res.status(204).end();
});

router.post("/athlete-invites/:inviteToken/live-taps", (req, res, next) => {
  // Anonymous visitors authorize with a family token. Native owners instead
  // present their session bearer, resolved through the verified account link.
  if (req.get("authorization") && !req.body?.accessToken) {
    requireAuthOrNativeOwner(req, res, next);
    return;
  }
  next();
}, async (req, res): Promise<void> => {
  const params = SendAthleteLiveTapParams.safeParse(req.params);
  const body = SendAthleteLiveTapBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose one of the available cheers." });
    return;
  }
  if (body.data.clientMutationId && !body.data.gameId) {
    res.status(400).json({ error: "Saved cheers must include their original game." });
    return;
  }
  const [invite] = await db.select().from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.publicToken, params.data.inviteToken));
  if (!invite || invite.paused || !(await isAccountActive(invite.ownerClerkUserId))) {
    res.status(404).json({ error: "This Hype Card is unavailable for Live Taps." });
    return;
  }
  if (!isLiveTapCheerForSport(invite.sport, body.data.cheerKey)) {
    res.status(400).json({ error: "Choose one of the available cheers for this sport." });
    return;
  }

  const callerId = typeof res.locals.clerkUserId === "string"
    ? getRequiredClerkUserId(res) : getOptionalClerkUserId(req);
  const tokenHash = body.data.accessToken ? hashAccessToken(body.data.accessToken) : null;
  const result = await db.transaction(async (tx) => {
    const [currentInvite] = await tx.select({
      id: athleteInvitesTable.id,
      ownerClerkUserId: athleteInvitesTable.ownerClerkUserId,
      paused: athleteInvitesTable.paused,
      liveTrackerShareToken: athleteInvitesTable.liveTrackerShareToken,
      seasonName: athleteInvitesTable.seasonName,
      liveTapsSeasonId: athleteInvitesTable.liveTapsSeasonId,
    }).from(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id)).for("update");
    if (!currentInvite || currentInvite.paused) return "unavailable" as const;

    let accessLinkId: string | null = null;
    if (callerId !== currentInvite.ownerClerkUserId) {
      if (!tokenHash) return "unauthorized" as const;
      const [accessLink] = await tx.select({ id: athleteInviteLiveTapAccessLinksTable.id })
        .from(athleteInviteLiveTapAccessLinksTable).where(and(
          eq(athleteInviteLiveTapAccessLinksTable.inviteId, invite.id),
          eq(athleteInviteLiveTapAccessLinksTable.tokenHash, tokenHash),
          isNull(athleteInviteLiveTapAccessLinksTable.revokedAt),
        )).for("update");
      if (!accessLink) return "unauthorized" as const;
      accessLinkId = accessLink.id;
    }

    // Check after authorization, but before the current-session gate. A response
    // can be lost immediately before End Live Taps; retrying that accepted tap
    // must acknowledge the receipt rather than count it again or lose it.
    if (body.data.clientMutationId) {
      const [receipt] = await tx.select().from(athleteInviteLiveTapsTable)
        .where(eq(athleteInviteLiveTapsTable.id, body.data.clientMutationId));
      if (receipt) {
        if (receipt.inviteId !== invite.id || receipt.gameId !== body.data.gameId
          || receipt.cheerKey !== body.data.cheerKey || receipt.accessLinkId !== accessLinkId) {
          return "mutation-conflict" as const;
        }
        const [currentShare] = currentInvite.liveTrackerShareToken
          ? await tx.select().from(statTrackerSharesTable).where(and(
            eq(statTrackerSharesTable.id, currentInvite.liveTrackerShareToken),
            eq(statTrackerSharesTable.ownerClerkUserId, currentInvite.ownerClerkUserId),
            gt(statTrackerSharesTable.expiresAt, new Date()),
          ))
          : [];
        const currentGame = currentShare?.game as Record<string, unknown> | undefined;
        const active = currentShare?.gameId === receipt.gameId
          && currentGame?.status !== "final" && currentGame?.liveTapsEnded !== true;
        return { gameId: receipt.gameId, seasonId: receipt.seasonId, active } as const;
      }
    }
    if (accessLinkId) {
      const [recent] = await tx.select({ value: count() }).from(athleteInviteLiveTapsTable).where(and(
        eq(athleteInviteLiveTapsTable.accessLinkId, accessLinkId),
        gt(athleteInviteLiveTapsTable.createdAt, new Date(Date.now() - LIVE_TAP_RATE_WINDOW_MS)),
      ));
      if ((recent?.value ?? 0) >= LIVE_TAP_RATE_LIMIT) return "limited" as const;
    }

    if (!currentInvite.liveTrackerShareToken) return "not-live" as const;
    const [share] = await tx.select({
      gameId: statTrackerSharesTable.gameId,
      game: statTrackerSharesTable.game,
    }).from(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.id, currentInvite.liveTrackerShareToken),
      eq(statTrackerSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
      gt(statTrackerSharesTable.expiresAt, new Date()),
    )).for("update");
    const game = share?.game && typeof share.game === "object"
      ? share.game as { status?: unknown; sport?: unknown; liveTapsEnded?: unknown; sourceEventId?: unknown }
      : null;
    if (!share || !game || game.status === "final" || game.liveTapsEnded === true || game.sport !== invite.sport) {
      return "not-live" as const;
    }
    if (body.data.gameId && body.data.gameId !== share.gameId) return "different-game" as const;
    const sourceEventId = typeof game.sourceEventId === "string" ? game.sourceEventId : share.gameId;
    if (body.data.expectedEventId && body.data.expectedEventId !== sourceEventId) return "different-game" as const;

    const seasonId = currentInvite.liveTapsSeasonId ?? randomUUID();
    if (!currentInvite.liveTapsSeasonId) {
      await tx.update(athleteInvitesTable).set({ liveTapsSeasonId: seasonId })
        .where(eq(athleteInvitesTable.id, currentInvite.id));
      await tx.update(athleteInviteLiveTapsTable).set({
        seasonId,
        seasonName: currentInvite.seasonName,
      }).where(and(
        eq(athleteInviteLiveTapsTable.inviteId, currentInvite.id),
        isNull(athleteInviteLiveTapsTable.seasonId),
      ));
    }
    const inserted = await tx.insert(athleteInviteLiveTapsTable).values({
      ...(body.data.clientMutationId ? { id: body.data.clientMutationId } : {}),
      inviteId: invite.id,
      seasonId,
      seasonName: currentInvite.seasonName,
      gameId: share.gameId,
      cheerKey: body.data.cheerKey,
      accessLinkId,
    }).onConflictDoNothing().returning({ id: athleteInviteLiveTapsTable.id });
    if (!inserted.length) return "mutation-conflict" as const;
    return { gameId: share.gameId, seasonId, active: true } as const;
  });

  if (result === "unauthorized") {
    res.status(403).json({ error: "A valid family Live Taps link is required to cheer." });
    return;
  }
  if (result === "limited") {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "This family link has reached its tap limit. Try again in a moment." });
    return;
  }
  if (result === "unavailable") {
    res.status(404).json({ error: "This Hype Card is unavailable for Live Taps." });
    return;
  }
  if (result === "not-live") {
    res.status(409).json({ error: "Live Taps are available only while Game Day Live is active." });
    return;
  }
  if (result === "different-game" || result === "mutation-conflict") {
    res.status(409).json({
      error: result === "different-game"
        ? "These saved cheers belong to an earlier game. They have not been sent to the new game."
        : "This saved cheer does not match its original receipt.",
    });
    return;
  }
  const summary = await getAthleteLiveTapsSummary(
    invite.id,
    invite.sport,
    result.gameId,
    result.seasonId,
  );
  // A receipt acknowledges delivery, not that an old session is still open.
  const [privacy] = await db.select({ showEvents: athleteInvitesTable.showEvents })
    .from(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id));
  const ownerOrEventsVisible = callerId === invite.ownerClerkUserId || privacy?.showEvents === true;
  res.status(201).json(SendAthleteLiveTapResponse.parse({
    ...visibleLiveTapSummary({ ...summary, active: result.active }, ownerOrEventsVisible, invite.id),
    active: result.active,
    ...(body.data.clientMutationId ? {
      receipt: visibleLiveTapReceipt({ id: body.data.clientMutationId, gameId: result.gameId,
        cheerKey: body.data.cheerKey }, ownerOrEventsVisible, invite.id),
    } : {}),
  }));
});

export default router;