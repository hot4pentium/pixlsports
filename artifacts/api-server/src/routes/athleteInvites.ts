import { createHash, randomBytes } from "crypto";
import { publicSoccerGear } from "../lib/soccerGear";
import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAthleteInviteBody,
  CreateAthleteInviteResponse,
  SendAthleteInviteHypeBody,
  SendAthleteInviteHypeParams,
  SendAthleteInviteHypeResponse,
  ListAthleteInviteHypesParams,
  ListAthleteInviteHypesResponse,
  ListPublicAthleteInviteHypesParams,
  ListPublicAthleteInviteHypesResponse,
  DeleteAthleteInviteHypeParams,
  DeleteAthleteInviteParams,
  GetAthleteInviteParams,
  GetAthleteInviteResponse,
  GetAthleteFanCardParams,
  GetAthleteFanCardResponse,
  GetAthleteInviteEventNotificationProgressParams,
  GetAthleteInviteEventNotificationProgressResponse,
  ListAthleteInvitesResponse,
  NotifyAthleteInviteEventFollowersParams,
  NotifyAthleteInviteEventFollowersResponse,
  StartAthleteInviteLiveParams,
  StartAthleteInviteLiveResponse,
  StopAthleteInviteLiveParams,
  StopAthleteInviteLiveResponse,
  StartAthleteInviteLiveBody,
  UpdateAthleteInviteBody,
  UpdateAthleteInviteParams,
  UpdateAthleteInviteResponse,
  UpdateAthleteInviteAppearanceBody,
  UpdateAthleteInviteAppearanceResponse,
} from "@workspace/api-zod";
import {
  athleteInvitesTable,
  athleteInviteHypesTable,
  cloudProjectsTable,
  db,
  hypeCardShareRepliesTable,
  hypeCardSharesTable,
  statTrackerSharesTable,
  scheduleSharesTable,
} from "@workspace/db";

import { isAccountActive } from "../lib/accountLifecycle";
import { computeHypeCardShareStats, isHypeCardSport } from "../lib/hypeCardShareStats";
import { notifyAthleteInviteHypeOwner } from "../lib/athleteInviteHypeNotification";
import { getAthleteLiveTapsSummary } from "../lib/athleteLiveTaps";
import { athletePhotoRevision } from "../lib/athletePhotoRevision";
import { sanitizeAthleteInvitePhoto } from "../lib/athleteInvitePhoto";
import { ObjectStorageService } from "../lib/objectStorage";
import { getOptionalClerkUserId, getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isIanaTimezone } from "../lib/timezone";
import { GAME_ON_CARD_MARKER } from "./scheduleShares";
import { getAthleteInviteEventNotificationProgress, notifyAthleteInviteEventFollowers } from "../lib/athleteInviteEventNotifications";

const router: IRouter = Router();
const photoStorage = new ObjectStorageService();

type InviteRow = typeof athleteInvitesTable.$inferSelect;

async function validateProject(
  projectId: string | null,
  ownerClerkUserId: string,
  expectedTool: "stat-tracker" | "schedule",
) {
  if (!projectId) return null;
  const [project] = await db
    .select()
    .from(cloudProjectsTable)
    .where(and(
      eq(cloudProjectsTable.id, projectId),
      eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
    ));
  const tool = project?.project && typeof project.project === "object"
    ? (project.project as { tool?: unknown }).tool
    : null;
  return project && tool === expectedTool ? project : null;
}

async function findFallbackTrackerProject(
  ownerClerkUserId: string,
  sport: string,
  status: "final" | "live",
) {
  // A page can be created before the first tracker save creates its cloud project.
  // Resolve that initial project without exposing another owner's tracker data.
  const projects = await db
    .select()
    .from(cloudProjectsTable)
    .where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId))
    .orderBy(desc(cloudProjectsTable.updatedAt));

  return projects.find((project) => {
    if (!project.project || typeof project.project !== "object" || Array.isArray(project.project)) return false;
    const payload = project.project as { tool?: unknown; games?: unknown };
    if (payload.tool !== "stat-tracker" || !Array.isArray(payload.games)) return false;
    return payload.games.some((game) => (
      game
      && typeof game === "object"
      && !Array.isArray(game)
      && (game as { sport?: unknown; status?: unknown }).sport === sport
      && (game as { sport?: unknown; status?: unknown }).status === status
    ));
  }) ?? null;
}

async function resolveTrackerProject(
  projectId: string | null,
  ownerClerkUserId: string,
  sport: string,
  status: "final" | "live",
) {
  return projectId
    ? validateProject(projectId, ownerClerkUserId, "stat-tracker")
    : findFallbackTrackerProject(ownerClerkUserId, sport, status);
}

async function validateSources(
  ownerClerkUserId: string,
  input: { trackerProjectId: string | null },
) {
  const tracker = await validateProject(input.trackerProjectId, ownerClerkUserId, "stat-tracker");
  return {
    valid: !input.trackerProjectId || Boolean(tracker),
    tracker,
  };
}

function cleanLiveGame(payload: unknown, fallbackId: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const item = payload as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id.slice(0, 120) : fallbackId;
  const status = item.status === "final" ? "final" : "live";
  return {
    id,
    sport: typeof item.sport === "string" ? item.sport.slice(0, 30) : "unknown",
    status,
    date: typeof item.date === "string" ? item.date.slice(0, 30) : "",
    opponent: typeof item.opponent === "string" ? item.opponent.slice(0, 200) : "",
    period: typeof item.period === "number" && Number.isFinite(item.period) ? item.period : 1,
    score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0,
    opponentScore: typeof item.opponentScore === "number" && Number.isFinite(item.opponentScore)
      ? item.opponentScore
      : 0,
    stats: item.stats && typeof item.stats === "object" && !Array.isArray(item.stats) ? item.stats : {},
    trackYards: item.trackYards === true,
    yardStats: item.yardStats && typeof item.yardStats === "object" && !Array.isArray(item.yardStats)
      ? item.yardStats
      : {},
    events: Array.isArray(item.events) ? item.events.slice(-10) : [],
  };
}

function cleanVideoLabel(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeMediaName(value: unknown) {
  const label = cleanVideoLabel(value, 80);
  return label
    && !/^(?:IMG|VID|MOV|DSC|PXL|Screenshot)[ _-]?\d+(?:\.[a-z0-9]{1,8})?$/i.test(label)
    && !/[\u0000-\u001f\u007f\\/<>{}[\]|`$]/u.test(label)
    ? label
    : "";
}

function manifestProject(share: typeof hypeCardSharesTable.$inferSelect) {
  const manifest = share.manifest && typeof share.manifest === "object" && !Array.isArray(share.manifest)
    ? share.manifest as Record<string, unknown>
    : {};
  return manifest.project && typeof manifest.project === "object" && !Array.isArray(manifest.project)
    ? manifest.project as Record<string, unknown>
    : {};
}

function athleteMediaName(share: typeof hypeCardSharesTable.$inferSelect) {
  const project = manifestProject(share);
  return safeMediaName(share.mediaName)
    || safeMediaName(project.mediaName)
    || safeMediaName(project.headline)
    || "Game Day highlight";
}

function athleteVideoResponse(share: typeof hypeCardSharesTable.$inferSelect) {
  const project = manifestProject(share);
  const mediaName = athleteMediaName(share);
  return {
    shareToken: share.publicToken,
    title: mediaName,
    mediaName,
    jerseyNumber: cleanVideoLabel(project.jerseyNumber, 40),
    position: cleanVideoLabel(project.position, 100),
    videoUrl: `/api/hype-card-shares/${share.publicToken}/media/video`,
    posterUrl: share.posterObjectPath
      ? `/api/hype-card-shares/${share.publicToken}/media/poster`
      : null,
    createdAt: share.createdAt,
  };
}

function sourceEventFromCard(events: unknown) {
  if (!Array.isArray(events) || events.length !== 1) return null;
  const event: unknown = events[0];
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const item = event as Record<string, unknown>;
  return item.type === "game" || item.type === "practice" ? item : null;
}

function validEventDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function availableAthleteEvents(invite: InviteRow) {
  const ownerShares = await db.select({ share: scheduleSharesTable })
    .from(scheduleSharesTable)
    .where(and(
      eq(scheduleSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
      eq(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
    ))
    .orderBy(desc(scheduleSharesTable.createdAt));
  const eligible = ownerShares.flatMap(({ share }) => {
    const event = sourceEventFromCard(share.events);
    if (!event || typeof event.id !== "string" || !validEventDate(event.date)) return [];
    return [{ share, event }];
  });
  const gameIds = [...new Set(eligible.flatMap(({ event }) => event.type === "game" ? [event.id as string] : []))];
  const trackerStatusByGame = new Map<string, string>();
  if (gameIds.length) {
    const trackerRows = await db.select({
      gameId: statTrackerSharesTable.gameId,
      game: statTrackerSharesTable.game,
    }).from(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
      inArray(statTrackerSharesTable.gameId, gameIds),
    ));
    for (const tracker of trackerRows) {
      const game = tracker.game && typeof tracker.game === "object" && !Array.isArray(tracker.game)
        ? tracker.game as Record<string, unknown>
        : {};
      if (game.status === "final" || game.status === "live") trackerStatusByGame.set(tracker.gameId, game.status);
    }
  }
  return eligible.map(({ share, event }) => {
    const eventStatus = event.status === "final" || event.status === "live" ? event.status : "upcoming";
    const trackerStatus = event.type === "game" ? trackerStatusByGame.get(event.id as string) : undefined;
    const status = eventStatus === "final" || trackerStatus === "final"
      ? "final"
      : eventStatus === "live" || trackerStatus === "live"
        ? "live"
        : "upcoming";
    return {
      shareToken: share.id,
      eventId: event.id as string,
      title: share.title,
      date: event.date as string,
      time: typeof event.time === "string" ? event.time : "",
      type: event.type as "game" | "practice",
      status,
      opponent: typeof event.opponent === "string" ? event.opponent : "",
      location: typeof event.location === "string" ? event.location : "",
    };
  });
}

async function publicAthleteInviteData(invite: InviteRow, isOwner: boolean) {
  const maxHighlightVideos = 3;
  const [trackerProject, latestImages, videos, liveShare, events] = await Promise.all([
    invite.showStats && invite.trackerProjectId
      ? validateProject(invite.trackerProjectId, invite.ownerClerkUserId, "stat-tracker")
      : invite.showStats
        ? findFallbackTrackerProject(invite.ownerClerkUserId, invite.sport, "final")
        : null,
    invite.showHypeCard
      ? db.select().from(hypeCardSharesTable).where(and(
        eq(hypeCardSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
        eq(hypeCardSharesTable.shareMode, "card"),
        eq(hypeCardSharesTable.mediaType, "image"),
        isNull(hypeCardSharesTable.revokedAt),
        gt(hypeCardSharesTable.expiresAt, new Date()),
      )).orderBy(desc(hypeCardSharesTable.createdAt)).limit(1)
      : Promise.resolve([]),
    invite.showHypeCard
      ? db.select().from(hypeCardSharesTable).where(and(
        eq(hypeCardSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
        eq(hypeCardSharesTable.shareMode, "card"),
        eq(hypeCardSharesTable.mediaType, "video"),
        isNull(hypeCardSharesTable.revokedAt),
        gt(hypeCardSharesTable.expiresAt, new Date()),
      )).orderBy(desc(hypeCardSharesTable.createdAt)).limit(maxHighlightVideos)
      : Promise.resolve([]),
    invite.liveTrackerShareToken
      ? db.select().from(statTrackerSharesTable).where(and(
        eq(statTrackerSharesTable.id, invite.liveTrackerShareToken),
        eq(statTrackerSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
        gt(statTrackerSharesTable.expiresAt, new Date()),
      )).then(([share]) => share ?? null)
      : Promise.resolve(null),
    invite.showEvents ? availableAthleteEvents(invite) : Promise.resolve([]),
  ]);
  const latestImage = latestImages[0] ?? null;
  const latestVideo = videos[0] ?? null;
  const replies = videos.length
    ? await db.select().from(hypeCardShareRepliesTable).where(
      inArray(hypeCardShareRepliesTable.shareId, videos.map((share) => share.id)),
    ).orderBy(desc(hypeCardShareRepliesTable.createdAt)).limit(50)
    : [];
  const stats = trackerProject && isHypeCardSport(invite.sport)
    ? computeHypeCardShareStats(
      trackerProject.project,
      invite.athleteName,
      invite.sport,
      trackerProject.updatedAt,
    )
    : null;
  const updatedAt = new Date(Math.max(
    invite.updatedAt.getTime(),
    trackerProject?.updatedAt.getTime() ?? 0,
    latestImage?.createdAt.getTime() ?? 0,
    latestVideo?.createdAt.getTime() ?? 0,
  ));
  const liveGame = liveShare
    && liveShare.game
    && typeof liveShare.game === "object"
    && (liveShare.game as { status?: unknown }).status !== "final"
    ? liveShare.game as Record<string, unknown>
    : null;
  const liveScoreboard = liveGame && typeof liveGame.score === "number" && Number.isFinite(liveGame.score)
    && liveGame.score >= 0 && typeof liveGame.opponentScore === "number"
    && Number.isFinite(liveGame.opponentScore) && liveGame.opponentScore >= 0
    ? {
      score: liveGame.score,
      opponentScore: liveGame.opponentScore,
      opponent: typeof liveGame.opponent === "string" ? liveGame.opponent.slice(0, 200) : "",
      status: "live" as const,
      ...(typeof liveGame.period === "number" && Number.isInteger(liveGame.period) && liveGame.period > 0
        ? { period: liveGame.period }
        : {}),
      athleteName: invite.athleteName,
      teamName: invite.teamName,
    }
    : null;
  const liveTaps = await getAthleteLiveTapsSummary(
    invite.id,
    invite.sport,
    liveGame && liveShare?.gameId ? liveShare.gameId : null,
  );

  return {
    inviteToken: invite.publicToken,
    athleteName: invite.athleteName,
    teamName: invite.teamName,
    seasonName: invite.seasonName,
    seasonEndsAt: invite.seasonEndsAt,
    sport: invite.sport,
    showEvents: invite.showEvents,
    photoUrl: invite.photoObjectPath && (!invite.paused || isOwner)
      ? `/api/athlete-invites/${invite.publicToken}/photo/image?v=${athletePhotoRevision(invite.photoObjectPath)}`
      : null,
    cutoutUrl: invite.cutoutObjectPath && (!invite.paused || isOwner)
      ? `/api/athlete-invites/${invite.publicToken}/photo/image?role=cutout&v=${athletePhotoRevision(invite.cutoutObjectPath)}`
      : null,
    cardAppearance: invite.cardAppearance ?? null,
    hypeCard: latestImage ? {
      shareToken: latestImage.publicToken,
      title: athleteMediaName(latestImage),
      mediaName: athleteMediaName(latestImage),
      mediaType: "image" as const,
      posterUrl: latestImage.videoObjectPath
        ? `/api/hype-card-shares/${latestImage.publicToken}/media/video`
        : null,
      createdAt: latestImage.createdAt,
    } : null,
    videos: videos.map(athleteVideoResponse),
    stats,
    scheduleEvents: [],
    events,
    replies: replies.map((reply) => ({
      reaction: reply.reaction,
      message: reply.message,
      createdAt: reply.createdAt,
    })),
    liveGame: liveShare && liveGame ? {
      shareToken: liveShare.id,
      gameId: liveShare.gameId,
      expiresAt: liveShare.expiresAt,
    } : null,
    liveScoreboard,
    liveTaps,
    updatedAt,
  };
}

async function ownedInviteResponse(invite: InviteRow) {
  return {
    inviteToken: invite.publicToken,
    athleteName: invite.athleteName,
    teamName: invite.teamName,
    seasonName: invite.seasonName,
    seasonEndsAt: invite.seasonEndsAt,
    sport: invite.sport,
    timezone: invite.timezone,
    trackerProjectId: invite.trackerProjectId,
    scheduleProjectId: invite.scheduleProjectId,
    showHypeCard: invite.showHypeCard,
    showStats: invite.showStats,
    showSchedule: invite.showSchedule,
    showEvents: invite.showEvents,
    hypesEnabled: invite.hypesEnabled,
    paused: invite.paused,
    liveTrackerShareToken: invite.liveTrackerShareToken,
    photoUrl: invite.photoObjectPath
      ? `/api/athlete-invites/${invite.publicToken}/photo/image?v=${athletePhotoRevision(invite.photoObjectPath)}`
      : null,
    cutoutUrl: invite.cutoutObjectPath
      ? `/api/athlete-invites/${invite.publicToken}/photo/image?role=cutout&v=${athletePhotoRevision(invite.cutoutObjectPath)}`
      : null,
    photoRevision: athletePhotoRevision(invite.photoObjectPath),
    cardAppearance: invite.cardAppearance ?? null,
    events: invite.showEvents ? await availableAthleteEvents(invite) : [],
    createdAt: invite.createdAt,
    updatedAt: invite.updatedAt,
  };
}

router.get("/athlete-invites", requireAuth, async (_req, res): Promise<void> => {
  const invites = await db
    .select()
    .from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)))
    .orderBy(desc(athleteInvitesTable.createdAt));
  res.json(ListAthleteInvitesResponse.parse(await Promise.all(invites.map(ownedInviteResponse))));
});

router.post("/athlete-invites", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateAthleteInviteBody.safeParse(req.body);
  if (!parsed.success || !isIanaTimezone(parsed.data?.timezone)) {
    res.status(400).json({ error: "Choose an athlete, season, and page details." });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const sources = await validateSources(ownerClerkUserId, parsed.data);
  if (!sources.valid) {
    res.status(400).json({ error: "Choose tracker and schedule projects owned by this account." });
    return;
  }
  try {
    const [existing] = await db.select({ id: athleteInvitesTable.id })
      .from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId)).limit(1);
    if (existing) {
      res.status(409).json({ error: "This account already has an athlete invite. Update or revoke it first." });
      return;
    }
    const [created] = await db.insert(athleteInvitesTable).values({
      ...parsed.data,
      photoObjectPath: null,
      scheduleProjectId: null,
      showSchedule: false,
      paused: parsed.data.paused ?? false,
      athleteName: parsed.data.athleteName.trim(),
      teamName: parsed.data.teamName.trim(),
      seasonName: parsed.data.seasonName.trim(),
      ownerClerkUserId,
      publicToken: randomBytes(24).toString("base64url"),
    }).returning();
    res.status(201).json(CreateAthleteInviteResponse.parse(await ownedInviteResponse(created)));
  } catch (error) {
    const duplicate = [error, error instanceof Error ? error.cause : null]
      .some(cause => cause && typeof cause === "object" && "code" in cause && cause.code === "23505");
    if (duplicate) {
      res.status(409).json({ error: "This account already has an athlete invite. Update or revoke it first." });
      return;
    }
    req.log.error({ err: error }, "Unable to create athlete invite");
    res.status(500).json({ error: "Unable to create athlete invite" });
  }
});

router.get("/athlete-invites/:inviteToken", async (req, res): Promise<void> => {
  const params = GetAthleteInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  const [invite] = await db.select().from(athleteInvitesTable).where(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
  );
  const viewerClerkUserId = getOptionalClerkUserId(req);
  const isOwner = Boolean(viewerClerkUserId && viewerClerkUserId === invite?.ownerClerkUserId);
  if (!invite || (invite.paused && !isOwner) || !(await isAccountActive(invite.ownerClerkUserId))) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }

  res.json(GetAthleteInviteResponse.parse(await publicAthleteInviteData(invite, isOwner)));
});

router.get("/athlete-invites/:inviteToken/fan", async (req, res): Promise<void> => {
  const params = GetAthleteFanCardParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  const [invite] = await db.select().from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.publicToken, params.data.inviteToken)).limit(1);
  if (!invite || invite.paused
    || !(await isAccountActive(invite.ownerClerkUserId))) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  const { liveGame: _liveGame, ...card } = await publicAthleteInviteData(invite, false);
  void _liveGame;
  res.json(GetAthleteFanCardResponse.parse({
    ...card,
    soccerGear: await publicSoccerGear(invite),
    timezone: isIanaTimezone(invite.timezone) ? invite.timezone : null,
    hypesEnabled: invite.hypesEnabled,
  }));
});

router.post("/athlete-invites/:inviteToken/events/:shareToken/notify", requireAuth, async (req, res): Promise<void> => {
  const params = NotifyAthleteInviteEventFollowersParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Event Card not found" }); return; }
  const outcome = await notifyAthleteInviteEventFollowers(
    params.data.inviteToken,
    getRequiredClerkUserId(res),
    params.data.shareToken,
    { background: true },
  );
  if (outcome.status === "not-found") {
    res.status(404).json({ error: "Athlete invite or Event Card not found" });
    return;
  }
  if (outcome.status === "not-upcoming") {
    res.status(409).json({ error: "Only an upcoming Game On event on an Events-enabled HYPE Card can be announced." });
    return;
  }
  res.json(NotifyAthleteInviteEventFollowersResponse.parse({
    eligible: outcome.eligible,
    sent: outcome.sent,
    failed: outcome.failed,
    pending: outcome.pending,
    remaining: outcome.remaining,
  }));
});

router.get("/athlete-invites/:inviteToken/events/:shareToken/notify", requireAuth, async (req, res): Promise<void> => {
  const params = GetAthleteInviteEventNotificationProgressParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Event Card not found" }); return; }
  const outcome = await getAthleteInviteEventNotificationProgress(
    params.data.inviteToken, getRequiredClerkUserId(res), params.data.shareToken,
  );
  if (outcome.status === "not-found") {
    res.status(404).json({ error: "Athlete invite or Event Card not found" });
    return;
  }
  if (outcome.status === "not-upcoming") {
    res.status(409).json({ error: "Only an upcoming Game On event on an Events-enabled HYPE Card can be announced." });
    return;
  }
  res.json(GetAthleteInviteEventNotificationProgressResponse.parse(outcome));
});

router.post("/athlete-invites/:inviteToken/hypes", async (req, res): Promise<void> => {
  const params = SendAthleteInviteHypeParams.safeParse(req.params);
  const body = SendAthleteInviteHypeBody.safeParse(req.body);
  const senderName = body.success ? body.data.senderName?.trim() || null : null;
  if (!params.success || !body.success
    || (senderName && /[\u0000-\u001f\u007f]/u.test(senderName))
    || (body.data.message && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.data.message))) {
    res.status(400).json({ error: "Choose an encouragement, with a name under 60 characters and message under 240 characters." });
    return;
  }
  const [invite] = await db.select().from(athleteInvitesTable).where(eq(athleteInvitesTable.publicToken, params.data.inviteToken));
  if (!invite || invite.paused || !invite.hypesEnabled || !(await isAccountActive(invite.ownerClerkUserId))) {
    res.status(404).json({ error: "This card is not accepting Hypes." });
    return;
  }
  const rateLimitKey = createHash("sha256")
    .update(`${process.env.SESSION_SECRET ?? "pixl-athlete-hypes"}:${invite.id}:${(req.ip || req.socket.remoteAddress || "unknown").trim()}`)
    .digest("hex");
  const accepted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${rateLimitKey}))`);
    // Lock the invite row so a concurrent pause or disable cannot race an accepted Hype.
    const rows = await tx.execute(sql`select id from athlete_invites where id = ${invite.id} and paused = false and hypes_enabled = true for update`);
    if (!rows.rows.length) return false;
    const [recent] = await tx.select({ value: count() }).from(athleteInviteHypesTable).where(and(
      eq(athleteInviteHypesTable.rateLimitKey, rateLimitKey),
      gt(athleteInviteHypesTable.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
    ));
    if ((recent?.value ?? 0) >= 3) return "limited";
    const [hype] = await tx.insert(athleteInviteHypesTable).values({
      inviteId: invite.id,
      reaction: body.data.reaction,
      senderName,
      message: body.data.message?.trim() || null,
      publiclyVisible: body.data.publiclyVisible,
      rateLimitKey,
    }).returning({ id: athleteInviteHypesTable.id });
    return hype?.id ?? false;
  });
  if (accepted === "limited") {
    res.setHeader("Retry-After", "3600");
    res.status(429).json({ error: "You've sent several Hypes. Please try again later." });
    return;
  }
  if (!accepted) {
    res.status(404).json({ error: "This card is not accepting Hypes." });
    return;
  }
  void notifyAthleteInviteHypeOwner(invite, accepted)
    .catch((error) => req.log.warn({ err: error, inviteId: invite.id }, "Unable to send athlete invite fan Hype push"));
  res.status(201).json(SendAthleteInviteHypeResponse.parse({ accepted: true }));
});

router.get("/athlete-invites/:inviteToken/hypes", requireAuth, async (req, res): Promise<void> => {
  const params = ListAthleteInviteHypesParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Card not found" }); return; }
  const [invite] = await db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  ));
  if (!invite) { res.status(404).json({ error: "Card not found" }); return; }
  const hypes = await db.select({
    id: athleteInviteHypesTable.id,
    reaction: athleteInviteHypesTable.reaction,
    senderName: athleteInviteHypesTable.senderName,
    message: athleteInviteHypesTable.message,
    publiclyVisible: athleteInviteHypesTable.publiclyVisible,
    createdAt: athleteInviteHypesTable.createdAt,
  }).from(athleteInviteHypesTable).where(eq(athleteInviteHypesTable.inviteId, invite.id))
    .orderBy(desc(athleteInviteHypesTable.createdAt)).limit(100);
  res.json(ListAthleteInviteHypesResponse.parse(hypes));
});

router.get("/athlete-invites/:inviteToken/public-shoutouts", async (req, res): Promise<void> => {
  const params = ListPublicAthleteInviteHypesParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Card not found" }); return; }
  const [invite] = await db.select({
    id: athleteInvitesTable.id,
    ownerClerkUserId: athleteInvitesTable.ownerClerkUserId,
    paused: athleteInvitesTable.paused,
  }).from(athleteInvitesTable).where(eq(athleteInvitesTable.publicToken, params.data.inviteToken));
  if (!invite || invite.paused || !(await isAccountActive(invite.ownerClerkUserId))) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  const hypes = await db.select({
    id: athleteInviteHypesTable.id,
    reaction: athleteInviteHypesTable.reaction,
    message: athleteInviteHypesTable.message,
    createdAt: athleteInviteHypesTable.createdAt,
  }).from(athleteInviteHypesTable).where(and(
    eq(athleteInviteHypesTable.inviteId, invite.id),
    eq(athleteInviteHypesTable.publiclyVisible, true),
  )).orderBy(desc(athleteInviteHypesTable.createdAt)).limit(100);
  res.json(ListPublicAthleteInviteHypesResponse.parse(hypes));
});

router.delete("/athlete-invites/:inviteToken/hypes/:hypeId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteAthleteInviteHypeParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Hype not found" }); return; }
  const [invite] = await db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  ));
  if (!invite) { res.status(404).json({ error: "Hype not found" }); return; }
  const [deleted] = await db.delete(athleteInviteHypesTable).where(and(
    eq(athleteInviteHypesTable.id, params.data.hypeId),
    eq(athleteInviteHypesTable.inviteId, invite.id),
  )).returning({ id: athleteInviteHypesTable.id });
  if (!deleted) { res.status(404).json({ error: "Hype not found" }); return; }
  res.status(204).send();
});

router.patch("/athlete-invites/:inviteToken/appearance", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAthleteInviteParams.safeParse(req.params);
  const parsed = UpdateAthleteInviteAppearanceBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose valid card colors and athlete placement." });
    return;
  }
  const appearance = parsed.data;
  const [updated] = await db.update(athleteInvitesTable).set({
    cardAppearance: {
      ...appearance,
      accentColor: appearance.accentLinked ? appearance.borderColor : appearance.accentColor,
    },
    updatedAt: new Date(),
  }).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  )).returning();
  if (!updated) { res.status(404).json({ error: "Athlete card not found." }); return; }
  res.json(UpdateAthleteInviteAppearanceResponse.parse(await ownedInviteResponse(updated)));
});

router.patch("/athlete-invites/:inviteToken", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAthleteInviteParams.safeParse(req.params);
  const parsed = UpdateAthleteInviteBody.safeParse(req.body);
  if (!params.success || !parsed.success || !isIanaTimezone(parsed.data?.timezone)) {
    res.status(400).json({ error: "Choose an athlete, season, and page details." });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const sources = await validateSources(ownerClerkUserId, parsed.data);
  if (!sources.valid) {
    res.status(400).json({ error: "Choose tracker and schedule projects owned by this account." });
    return;
  }
  const [current] = await db.select({
    liveTrackerShareToken: athleteInvitesTable.liveTrackerShareToken,
  }).from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  ));
  const [updated] = await db.update(athleteInvitesTable).set({
    ...parsed.data,
    scheduleProjectId: null,
    showSchedule: false,
    ...(parsed.data.paused === undefined ? {} : { paused: parsed.data.paused }),
    ...(parsed.data.paused === true ? { liveTrackerShareToken: null } : {}),
    athleteName: parsed.data.athleteName.trim(),
    teamName: parsed.data.teamName.trim(),
    seasonName: parsed.data.seasonName.trim(),
    updatedAt: new Date(),
  }).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  )).returning();
  if (!updated) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  if (parsed.data.paused === true && current?.liveTrackerShareToken) {
    await db.delete(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.id, current.liveTrackerShareToken),
      eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
    ));
  }
  res.json(UpdateAthleteInviteResponse.parse(await ownedInviteResponse(updated)));
});

router.delete("/athlete-invites/:inviteToken", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteAthleteInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  const [current] = await db.select({
    id: athleteInvitesTable.id,
    liveTrackerShareToken: athleteInvitesTable.liveTrackerShareToken,
  }).from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  ));
  if (!current) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  const [paused] = await db.update(athleteInvitesTable).set({
    paused: true,
    liveTrackerShareToken: null,
    updatedAt: new Date(),
  }).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  )).returning({ id: athleteInvitesTable.id });
  if (!paused) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  if (current.liveTrackerShareToken) {
    await db.delete(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.id, current.liveTrackerShareToken),
      eq(statTrackerSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
    ));
  }
  res.status(204).send(StopAthleteInviteLiveResponse.parse(undefined));
});

router.post("/athlete-invites/:inviteToken/live", requireAuth, async (req, res): Promise<void> => {
  const params = StartAthleteInviteLiveParams.safeParse(req.params);
  const bodyWasProvided = req.body !== undefined;
  const parsedBody = bodyWasProvided ? StartAthleteInviteLiveBody.safeParse(req.body) : null;
  if (!params.success) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  if (parsedBody && !parsedBody.success) {
    res.status(400).json({ error: "Choose a valid live tracker share." });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    eq(athleteInvitesTable.paused, false),
  ));
  if (!invite) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  let game: ReturnType<typeof cleanLiveGame> = null;
  let share: typeof statTrackerSharesTable.$inferSelect | undefined;
  if (parsedBody?.success) {
    const [linkedShare] = await db.select().from(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.id, parsedBody.data.shareToken),
      eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
      gt(statTrackerSharesTable.expiresAt, new Date()),
    ));
    const rawGame = linkedShare?.game && typeof linkedShare.game === "object" && !Array.isArray(linkedShare.game)
      ? linkedShare.game as Record<string, unknown>
      : null;
    game = rawGame?.status === "live" ? cleanLiveGame(rawGame, linkedShare?.gameId ?? "live-game") : null;
    if (
      !linkedShare
      || !game
      || game.sport !== invite.sport
      || game.id !== linkedShare.gameId
    ) {
      res.status(409).json({ error: "Choose a live tracker share for this athlete's sport." });
      return;
    }
    share = linkedShare;
  } else {
    const project = await resolveTrackerProject(invite.trackerProjectId, ownerClerkUserId, invite.sport, "live");
    const payload = project?.project && typeof project.project === "object"
      ? project.project as { games?: unknown }
      : null;
    const sourceGame = Array.isArray(payload?.games)
      ? payload.games.find((candidate) => candidate && typeof candidate === "object" && (candidate as { status?: unknown }).status === "live")
      : null;
    if (!sourceGame || typeof sourceGame !== "object") {
      res.status(409).json({ error: "Start a live game in the selected Stat Tracker first." });
      return;
    }
    game = cleanLiveGame(sourceGame, "live-game");
    if (!game) {
      res.status(409).json({ error: "The selected live game is unavailable." });
      return;
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const existingShare = invite.liveTrackerShareToken
      ? (await db.select().from(statTrackerSharesTable).where(and(
        eq(statTrackerSharesTable.id, invite.liveTrackerShareToken),
        eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
        gt(statTrackerSharesTable.expiresAt, new Date()),
      )))[0]
      : null;
    const sameGameShare = existingShare ?? (await db.select().from(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
      eq(statTrackerSharesTable.gameId, game.id),
      gt(statTrackerSharesTable.expiresAt, new Date()),
    )))[0];
    share = sameGameShare ?? (await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId,
      gameId: game.id,
      athleteName: invite.athleteName,
      teamName: invite.teamName,
      game,
      expiresAt,
    }).returning())[0];
  }
  if (!share) {
    res.status(409).json({ error: "Unable to start Game Day Live." });
    return;
  }
  await db.update(athleteInvitesTable).set({
    liveTrackerShareToken: share.id,
    updatedAt: new Date(),
  }).where(eq(athleteInvitesTable.id, invite.id));
  void import("./athleteInviteFeatures").then(({ notifyStartedAthleteInviteLive }) => (
    notifyStartedAthleteInviteLive(invite.id, share.id, game.id)
  )).catch((error) => req.log.error({ err: error }, "Unable to dispatch Athlete Hype Page live alerts"));
  res.status(201).json(StartAthleteInviteLiveResponse.parse({
    shareToken: share.id,
    gameId: share.gameId,
    expiresAt: share.expiresAt,
  }));
});

router.delete("/athlete-invites/:inviteToken/live", requireAuth, async (req, res): Promise<void> => {
  const params = StopAthleteInviteLiveParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  ));
  if (!invite) {
    res.status(404).json({ error: "Athlete Hype Page not found" });
    return;
  }
  if (invite.liveTrackerShareToken) {
    await db.delete(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.id, invite.liveTrackerShareToken),
      eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
    ));
  }
  await db.update(athleteInvitesTable).set({
    liveTrackerShareToken: null,
    updatedAt: new Date(),
  }).where(eq(athleteInvitesTable.id, invite.id));
  res.status(204).send(StopAthleteInviteLiveResponse.parse(undefined));
});

export default router;