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
import { getAthleteLiveTapsSummary, isLiveTapCheerForSport } from "../lib/athleteLiveTaps";
import { getOptionalClerkUserId, getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";

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

router.post("/athlete-invites/:inviteToken/live-taps", async (req, res): Promise<void> => {
  const params = SendAthleteLiveTapParams.safeParse(req.params);
  const body = SendAthleteLiveTapBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose one of the available cheers." });
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

  const callerId = getOptionalClerkUserId(req);
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
      const [recent] = await tx.select({ value: count() }).from(athleteInviteLiveTapsTable).where(and(
        eq(athleteInviteLiveTapsTable.accessLinkId, accessLink.id),
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
      ? share.game as { status?: unknown; sport?: unknown }
      : null;
    if (!share || !game || game.status === "final" || game.sport !== invite.sport) {
      return "not-live" as const;
    }

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
    await tx.insert(athleteInviteLiveTapsTable).values({
      inviteId: invite.id,
      seasonId,
      seasonName: currentInvite.seasonName,
      gameId: share.gameId,
      cheerKey: body.data.cheerKey,
      accessLinkId,
    });
    return { gameId: share.gameId, seasonId } as const;
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
  const summary = await getAthleteLiveTapsSummary(
    invite.id,
    invite.sport,
    result.gameId,
    result.seasonId,
  );
  res.status(201).json(SendAthleteLiveTapResponse.parse(summary));
});

export default router;