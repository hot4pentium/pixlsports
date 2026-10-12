import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { createAthleteInviteIcon, InvalidAthleteInvitePhotoError, sanitizeAthleteInvitePhoto } from "../lib/athleteInvitePhoto";
import {
  ConfirmAthleteInvitePhotoBody,
  ConfirmAthleteInvitePhotoParams,
  ConfirmAthleteInvitePhotoResponse,
  CreateAthleteInviteFanFollowBody,
  CreateAthleteInviteFanFollowParams,
  CreateAthleteInviteFanFollowResponse,
  DeleteAthleteInviteFanFollowHeader,
  DeleteAthleteInviteFanFollowParams,
  GetAthleteInviteFanFollowHeader,
  GetAthleteInviteFanFollowParams,
  GetAthleteInviteFanFollowResponse,
  GetAthleteInviteManifestParams,
  GetAthleteInviteManifestResponse,
  RemoveAthleteInvitePhotoParams,
  RequestAthleteInvitePhotoUploadUrlBody,
  RequestAthleteInvitePhotoUploadUrlParams,
  RequestAthleteInvitePhotoUploadUrlResponse,
  ServeAthleteInvitePhotoParams,
  ServeAthleteInviteIconParams,
  UpdateAthleteInviteFanFollowBody,
  UpdateAthleteInviteFanFollowHeader,
  UpdateAthleteInviteFanFollowParams,
  UpdateAthleteInviteFanFollowResponse,
} from "@workspace/api-zod";
import {
  athleteInviteFanRateLimitsTable,
  athleteInviteFansTable,
  athleteInvitePhotoUploadClaimsTable,
  athleteInvitesTable,
  db,
} from "@workspace/db";
import { isAccountActive } from "../lib/accountLifecycle";
import { athletePhotoRevision } from "../lib/athletePhotoRevision";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { getOptionalClerkUserId, getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { notifyAthleteInviteFans } from "../lib/athleteInviteFanNotifications";
import { getWebPushConfig, isAllowedPushEndpoint } from "../lib/webPush";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FOLLOW_RATE_WINDOW_MS = 60 * 60 * 1000;
const FOLLOW_RATE_LIMIT = 10;
const BASE_PATH_RE = /^\/?(?:[A-Za-z0-9_-]+\/?)*$/;

async function findActiveInvite(token: string) {
  const [invite] = await db.select().from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.publicToken, token)).limit(1);
  if (!invite || invite.paused
    || !(await isAccountActive(invite.ownerClerkUserId))) return null;
  return invite;
}

function followTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeBasePath(value: unknown) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > 200 || !BASE_PATH_RE.test(value)) return null;
  const normalized = `/${value.split("/").filter(Boolean).join("/")}`;
  return normalized === "/" ? "" : normalized;
}

async function isFollowTokenValid(req: Request) {
  const inviteToken = Array.isArray(req.params.inviteToken) ? req.params.inviteToken[0] : req.params.inviteToken;
  const followToken = req.get("X-Fan-Follow-Token") ?? "";
  if (typeof inviteToken !== "string" || !/^[A-Za-z0-9_-]{24,80}$/.test(inviteToken)
    || !/^[A-Za-z0-9_-]{40,100}$/.test(followToken)) return null;
  const [invite] = await db.select().from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.publicToken, inviteToken)).limit(1);
  if (!invite) return null;
  const [follow] = await db.select().from(athleteInviteFansTable).where(and(
    eq(athleteInviteFansTable.inviteId, invite.id),
    eq(athleteInviteFansTable.followTokenHash, followTokenHash(followToken)),
  )).limit(1);
  if (!follow) return null;
  const active = !invite.paused
    && await isAccountActive(invite.ownerClerkUserId);
  return { invite, follow, active };
}

async function requestRateLimited(req: Request, ownerClerkUserId: string) {
  const source = req.ip || req.socket.remoteAddress || "unknown";
  const rateKey = createHash("sha256")
    .update(`${process.env.SESSION_SECRET ?? "pixl-athlete-invite-follow"}:${source}`)
    .digest("hex");
  const now = new Date();
  const windowStart = new Date(now.getTime() - FOLLOW_RATE_WINDOW_MS);
  await db.delete(athleteInviteFanRateLimitsTable)
    .where(lte(athleteInviteFanRateLimitsTable.windowStartedAt, new Date(now.getTime() - 24 * FOLLOW_RATE_WINDOW_MS)));
  const [row] = await db.insert(athleteInviteFanRateLimitsTable).values({
    rateKey,
    ownerClerkUserId,
    windowStartedAt: now,
    attempts: 1,
  }).onConflictDoUpdate({
    target: athleteInviteFanRateLimitsTable.rateKey,
    set: {
      ownerClerkUserId,
      attempts: sql`case when ${athleteInviteFanRateLimitsTable.windowStartedAt} <= ${windowStart} then 1 else ${athleteInviteFanRateLimitsTable.attempts} + 1 end`,
      windowStartedAt: sql`case when ${athleteInviteFanRateLimitsTable.windowStartedAt} <= ${windowStart} then ${now} else ${athleteInviteFanRateLimitsTable.windowStartedAt} end`,
    },
  }).returning({ attempts: athleteInviteFanRateLimitsTable.attempts });
  return (row?.attempts ?? FOLLOW_RATE_LIMIT + 1) > FOLLOW_RATE_LIMIT;
}

router.post(
  "/athlete-invites/:inviteToken/photo/upload-url",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = RequestAthleteInvitePhotoUploadUrlParams.safeParse(req.params);
    const parsed = RequestAthleteInvitePhotoUploadUrlBody.safeParse(req.body);
    if (!params.success || !parsed.success || !ALLOWED_PHOTO_TYPES.has(parsed.data.contentType)
      || parsed.data.size > MAX_PHOTO_SIZE) {
      res.status(400).json({ error: "Choose a JPG, PNG, or WebP photo up to 5 MB." });
      return;
    }
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const [invite] = await db.select().from(athleteInvitesTable).where(and(
      eq(athleteInvitesTable.publicToken, params.data.inviteToken),
      eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    )).limit(1);
    if (!invite) { res.status(404).json({ error: "Athlete invite not found." }); return; }
    try {
      const uploadUrl = await storage.getObjectEntityUploadURL(parsed.data.contentType);
      const objectPath = storage.normalizeObjectEntityPath(uploadUrl);
      await db.insert(athleteInvitePhotoUploadClaimsTable).values({
        inviteId: invite.id,
        ownerClerkUserId,
        objectPath,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      res.json(RequestAthleteInvitePhotoUploadUrlResponse.parse({ uploadUrl, objectPath }));
    } catch (error) {
      req.log.error({ err: error }, "Unable to prepare athlete page photo upload");
      res.status(500).json({ error: "Unable to prepare photo upload." });
    }
  },
);

router.put(
  "/athlete-invites/:inviteToken/photo",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ConfirmAthleteInvitePhotoParams.safeParse(req.params);
    const parsed = ConfirmAthleteInvitePhotoBody.safeParse(req.body);
    if (!params.success || !parsed.success || !parsed.data.objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "Invalid photo upload." });
      return;
    }
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const [invite] = await db.select().from(athleteInvitesTable).where(and(
      eq(athleteInvitesTable.publicToken, params.data.inviteToken),
      eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    )).limit(1);
    if (!invite) { res.status(404).json({ error: "Athlete invite not found." }); return; }
    const isCutout = parsed.data.mediaRole === "cutout";
    if (isCutout && (!invite.photoObjectPath || parsed.data.sourcePhotoRevision !== athletePhotoRevision(invite.photoObjectPath))) {
      res.status(409).json({ error: "The original photo changed. Retry background removal with the current photo." });
      return;
    }
    let sanitizedPath: string | null = null;
    let photoPublished = false;
    try {
      const now = new Date();
      const [claim] = await db.delete(athleteInvitePhotoUploadClaimsTable).where(and(
        eq(athleteInvitePhotoUploadClaimsTable.inviteId, invite.id),
        eq(athleteInvitePhotoUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
        eq(athleteInvitePhotoUploadClaimsTable.objectPath, parsed.data.objectPath),
        gt(athleteInvitePhotoUploadClaimsTable.expiresAt, now),
      )).returning();
      if (!claim) { res.status(400).json({ error: "Photo upload expired. Choose the photo again." }); return; }
      const metadata = await storage.getObjectEntityMetadata(claim.objectPath);
      if (!ALLOWED_PHOTO_TYPES.has(metadata.contentType)) {
        await storage.deleteObjectEntity(claim.objectPath);
        res.status(400).json({ error: "Choose a JPG, PNG, or WebP photo." });
        return;
      }
      if (metadata.size > MAX_PHOTO_SIZE) {
        await storage.deleteObjectEntity(claim.objectPath);
        res.status(413).json({ error: "Photo must be 5 MB or smaller." });
        return;
      }
      await storage.trySetObjectEntityAclPolicy(claim.objectPath, {
        owner: ownerClerkUserId,
        visibility: "private",
      });
      const uploaded = await storage.getObjectEntityFile(claim.objectPath);
      const [originalBytes] = await uploaded.download();
      const sanitized = await sanitizeAthleteInvitePhoto(originalBytes, metadata.contentType, isCutout);
      sanitizedPath = await storage.savePrivateObjectEntity(
        sanitized.contents,
        sanitized.contentType,
        ownerClerkUserId,
      );
      const [updated] = await db.update(athleteInvitesTable).set({
        ...(isCutout ? { cutoutObjectPath: sanitizedPath } : { photoObjectPath: sanitizedPath, cutoutObjectPath: null }),
        updatedAt: new Date(),
      }).where(and(
        eq(athleteInvitesTable.id, invite.id),
        eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
        ...(isCutout && invite.photoObjectPath ? [eq(athleteInvitesTable.photoObjectPath, invite.photoObjectPath)] : []),
      )).returning({ publicToken: athleteInvitesTable.publicToken, updatedAt: athleteInvitesTable.updatedAt });
      if (!updated) {
        await storage.deleteObjectEntity(sanitizedPath);
        res.status(409).json({ error: "The original photo changed. Retry with the current photo." });
        return;
      }
      photoPublished = true;
      for (const oldPath of [isCutout ? null : invite.photoObjectPath, invite.cutoutObjectPath, claim.objectPath]) {
        if (!oldPath || oldPath === sanitizedPath) continue;
        try { await storage.deleteObjectEntity(oldPath); } catch (error) {
          if (!(error instanceof ObjectNotFoundError)) req.log.warn({ err: error }, "Unable to remove replaced athlete photo");
        }
      }
      res.json(ConfirmAthleteInvitePhotoResponse.parse({
        photoUrl: `/api/athlete-invites/${updated.publicToken}/photo/image?${isCutout ? "role=cutout&" : ""}v=${athletePhotoRevision(sanitizedPath)}`,
        photoRevision: athletePhotoRevision(isCutout ? invite.photoObjectPath : sanitizedPath),
      }));
    } catch (error) {
      if (error instanceof InvalidAthleteInvitePhotoError) {
        try { await storage.deleteObjectEntity(parsed.data.objectPath); } catch { /* Upload may already be unavailable. */ }
        res.status(400).json({ error: error.message });
        return;
      }
      try { await storage.deleteObjectEntity(parsed.data.objectPath); } catch { /* Upload may already be unavailable. */ }
      if (sanitizedPath && !photoPublished) {
        try { await storage.deleteObjectEntity(sanitizedPath); } catch { /* Unpublished derivative may already be gone. */ }
      }
      req.log.error({ err: error }, "Unable to confirm athlete page photo");
      res.status(500).json({ error: "Unable to save photo." });
    }
  },
);

router.delete(
  "/athlete-invites/:inviteToken/photo",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = RemoveAthleteInvitePhotoParams.safeParse(req.params);
    if (!params.success) { res.status(404).end(); return; }
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const [invite] = await db.select().from(athleteInvitesTable).where(and(
      eq(athleteInvitesTable.publicToken, params.data.inviteToken),
      eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    )).limit(1);
    if (!invite) { res.status(404).end(); return; }
    await db.update(athleteInvitesTable).set({ photoObjectPath: null, cutoutObjectPath: null, updatedAt: new Date() })
      .where(eq(athleteInvitesTable.id, invite.id));
    for (const objectPath of [invite.photoObjectPath, invite.cutoutObjectPath]) {
      if (!objectPath) continue;
      try { await storage.deleteObjectEntity(objectPath); } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) req.log.warn({ err: error }, "Unable to remove athlete page photo");
      }
    }
    res.status(204).end();
  },
);

router.get(
  "/athlete-invites/:inviteToken/photo/image",
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    const params = ServeAthleteInvitePhotoParams.safeParse(req.params);
    if (!params.success) { res.status(404).end(); return; }
    const [invite] = await db.select().from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.publicToken, params.data.inviteToken)).limit(1);
    const isOwner = Boolean(invite && getOptionalClerkUserId(req) === invite.ownerClerkUserId);
    const active = invite && !invite.paused
      && await isAccountActive(invite.ownerClerkUserId);
    const isCutout = req.query.role === "cutout";
    const objectPath = isCutout ? invite?.cutoutObjectPath : invite?.photoObjectPath;
    const requestedRevision = req.query.v;
    const currentRevision = objectPath ? athletePhotoRevision(objectPath) : null;
    const legacyRevision = invite?.updatedAt.getTime().toString();
    if (!objectPath || (!active && !isOwner)
      || typeof requestedRevision !== "string"
      || (requestedRevision !== currentRevision && requestedRevision !== legacyRevision)) {
      res.status(404).end();
      return;
    }
    try {
      const [contents] = await (await storage.getObjectEntityFile(objectPath)).download();
      res.type("image/webp").send(contents);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) { res.status(404).end(); return; }
      req.log.error({ err: error }, "Unable to serve athlete page photo");
      res.status(500).end();
    }
  },
);

router.get(
  "/athlete-invites/:inviteToken/icon/:size.png",
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    const params = ServeAthleteInviteIconParams.safeParse({ ...req.params, size: Number(req.params.size) });
    if (!params.success || (params.data.size !== 192 && params.data.size !== 512)) {
      res.status(404).end();
      return;
    }
    const invite = await findActiveInvite(params.data.inviteToken);
    if (!invite) { res.status(404).end(); return; }
    try {
      const photo = invite.photoObjectPath
        ? (await storage.getObjectEntityFile(invite.photoObjectPath)).download().then(([contents]) => contents)
        : Promise.resolve(null);
      res.type("png").send(await createAthleteInviteIcon(await photo, params.data.size));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) { res.status(404).end(); return; }
      req.log.error({ err: error }, "Unable to build athlete page install icon");
      res.status(500).end();
    }
  },
);

router.get(
  "/athlete-invites/:inviteToken/manifest.webmanifest",
  async (req, res): Promise<void> => {
    const params = GetAthleteInviteManifestParams.safeParse(req.params);
    const basePath = safeBasePath(req.query.basePath);
    if (!params.success || basePath === null) {
      res.status(400).json({ error: "Invalid athlete manifest path." });
      return;
    }
    const invite = await findActiveInvite(params.data.inviteToken);
    if (!invite) { res.status(404).json({ error: "Athlete invite not found." }); return; }
    const fanUrl = `${basePath}/fan/${invite.publicToken}`;
    res.type("application/manifest+json")
      .setHeader("Cache-Control", "public, max-age=60")
      .json(GetAthleteInviteManifestResponse.parse({
        id: fanUrl,
        name: `${invite.athleteName} · ${invite.teamName}`,
        short_name: invite.athleteName.slice(0, 20),
        start_url: fanUrl,
        scope: basePath ? `${basePath}/` : "/",
        display: "standalone",
        icons: [
          { src: `${basePath}/api/athlete-invites/${invite.publicToken}/icon/192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `${basePath}/api/athlete-invites/${invite.publicToken}/icon/512.png`, sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      }));
  },
);

router.post(
  "/athlete-invites/:inviteToken/follows",
  async (req, res): Promise<void> => {
    const params = CreateAthleteInviteFanFollowParams.safeParse(req.params);
    const parsed = CreateAthleteInviteFanFollowBody.safeParse(req.body);
    if (!params.success || !parsed.success
      || (!parsed.data.liveAlerts && !parsed.data.eventAlerts && !parsed.data.preEventAlerts)) {
      res.status(400).json({ error: "Choose at least one alert and provide a valid browser subscription." });
      return;
    }
    if (!getWebPushConfig().available) {
      res.status(503).json({ error: "Push notifications are not configured on this server." });
      return;
    }
    let endpoint: URL;
    try {
      endpoint = new URL(parsed.data.endpoint);
    } catch {
      res.status(400).json({ error: "Invalid push endpoint." });
      return;
    }
    if (!isAllowedPushEndpoint(endpoint.toString())) {
      res.status(400).json({ error: "Push endpoint must belong to a supported browser push service." });
      return;
    }
    const invite = await findActiveInvite(params.data.inviteToken);
    if (!invite) { res.status(404).json({ error: "Athlete invite not found." }); return; }
    if (await requestRateLimited(req, invite.ownerClerkUserId)) {
      res.status(429).json({ error: "Too many follow attempts. Try again later." });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    try {
      const [follow] = await db.insert(athleteInviteFansTable).values({
        inviteId: invite.id,
        endpoint: endpoint.toString(),
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        followTokenHash: followTokenHash(token),
        liveAlerts: parsed.data.liveAlerts,
        eventAlerts: parsed.data.eventAlerts,
        preEventAlerts: parsed.data.preEventAlerts ?? false,
      }).onConflictDoNothing().returning();
      if (!follow) {
        res.status(409).json({ error: "This browser subscription is already following an invite." });
        return;
      }
      res.status(201).json(CreateAthleteInviteFanFollowResponse.parse({
        followToken: token,
        liveAlerts: follow.liveAlerts,
        eventAlerts: follow.eventAlerts,
        preEventAlerts: follow.preEventAlerts,
        active: true,
      }));
    } catch (error) {
      req.log.error({ err: error }, "Unable to create athlete invite fan follow");
      res.status(500).json({ error: "Unable to create follow." });
    }
  },
);

router.get(
  "/athlete-invites/:inviteToken/follows/me",
  async (req, res): Promise<void> => {
    const params = GetAthleteInviteFanFollowParams.safeParse(req.params);
    const header = GetAthleteInviteFanFollowHeader.safeParse({ "X-Fan-Follow-Token": req.get("X-Fan-Follow-Token") });
    if (!params.success || !header.success) { res.status(404).json({ error: "Follow not found." }); return; }
    const record = await isFollowTokenValid(req);
    if (!record) { res.status(404).json({ error: "Follow not found." }); return; }
    res.json(GetAthleteInviteFanFollowResponse.parse({
      liveAlerts: record.follow.liveAlerts,
      eventAlerts: record.follow.eventAlerts,
      preEventAlerts: record.follow.preEventAlerts,
      active: record.active,
    }));
  },
);

router.patch(
  "/athlete-invites/:inviteToken/follows/me",
  async (req, res): Promise<void> => {
    const params = UpdateAthleteInviteFanFollowParams.safeParse(req.params);
    const header = UpdateAthleteInviteFanFollowHeader.safeParse({ "X-Fan-Follow-Token": req.get("X-Fan-Follow-Token") });
    const parsed = UpdateAthleteInviteFanFollowBody.safeParse(req.body);
    if (!params.success || !header.success || !parsed.success) {
      res.status(400).json({ error: "Choose at least one alert." });
      return;
    }
    const record = await isFollowTokenValid(req);
    if (!record) { res.status(404).json({ error: "Follow not found." }); return; }
    const liveAlerts = parsed.data.liveAlerts ?? record.follow.liveAlerts;
    const eventAlerts = parsed.data.eventAlerts ?? record.follow.eventAlerts;
    const preEventAlerts = parsed.data.preEventAlerts ?? record.follow.preEventAlerts;
    if (!liveAlerts && !eventAlerts && !preEventAlerts) {
      res.status(400).json({ error: "Choose at least one alert." });
      return;
    }
    const [updated] = await db.update(athleteInviteFansTable).set({
      liveAlerts,
      eventAlerts,
      preEventAlerts,
      updatedAt: new Date(),
    }).where(eq(athleteInviteFansTable.id, record.follow.id)).returning();
    if (!updated) { res.status(404).json({ error: "Follow not found." }); return; }
    res.json(UpdateAthleteInviteFanFollowResponse.parse({
      liveAlerts: updated.liveAlerts,
      eventAlerts: updated.eventAlerts,
      preEventAlerts: updated.preEventAlerts,
      active: record.active,
    }));
  },
);

router.delete(
  "/athlete-invites/:inviteToken/follows/me",
  async (req, res): Promise<void> => {
    const params = DeleteAthleteInviteFanFollowParams.safeParse(req.params);
    const header = DeleteAthleteInviteFanFollowHeader.safeParse({ "X-Fan-Follow-Token": req.get("X-Fan-Follow-Token") });
    if (!params.success || !header.success) { res.status(404).end(); return; }
    const record = await isFollowTokenValid(req);
    if (!record) { res.status(404).end(); return; }
    await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.id, record.follow.id));
    res.status(204).end();
  },
);

export async function notifyStartedAthleteInviteLive(inviteId: string, shareId: string, gameId: string) {
  await notifyAthleteInviteFans(inviteId, gameId, "live", { liveShareId: shareId });
}

export default router;