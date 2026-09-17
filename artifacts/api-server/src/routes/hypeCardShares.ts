import { randomBytes } from "crypto";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateHypeCardShareBody,
  CreateHypeCardShareResponse,
  DeleteHypeCardShareParams,
  GetHypeCardShareParams,
  ListHypeCardSharesResponse,
  RequestHypeCardShareUploadUrlBody,
  RequestHypeCardShareUploadUrlResponse,
  ServeHypeCardShareMediaParams,
} from "@workspace/api-zod";
import { cloudProjectsTable, db, hypeCardSharesTable, hypeCardShareUploadClaimsTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isAccountActive } from "../lib/accountLifecycle";
import { computeHypeCardShareStats, isHypeCardSport } from "../lib/hypeCardShareStats";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_VIDEO_BYTES = 35 * 1024 * 1024;
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 400 * 1024;
const UPLOAD_CLAIM_LIFETIME_MS = 2 * 60 * 60 * 1000;

function activeShareWhere(publicToken: string) {
  return and(
    eq(hypeCardSharesTable.publicToken, publicToken),
    isNull(hypeCardSharesTable.revokedAt),
    gt(hypeCardSharesTable.expiresAt, new Date()),
  );
}

function publicManifest(manifest: unknown) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return manifest;
  const { shareKey: _shareKey, ...safeManifest } = manifest as Record<string, unknown>;
  return safeManifest;
}

async function shareResponse(
  share: typeof hypeCardSharesTable.$inferSelect,
  includeOwnerDetails = false,
) {
  let stats = null;
  if (share.trackerProjectId && share.athleteName && isHypeCardSport(share.sport)) {
    const [project] = await db.select().from(cloudProjectsTable).where(and(
      eq(cloudProjectsTable.id, share.trackerProjectId),
      eq(cloudProjectsTable.ownerClerkUserId, share.ownerClerkUserId),
    ));
    if (project) {
      stats = computeHypeCardShareStats(
        project.project,
        share.athleteName,
        share.sport,
        project.updatedAt,
      );
    }
  }
  return CreateHypeCardShareResponse.parse({
    shareToken: share.publicToken,
    slug: share.slug,
    title: share.title,
    manifest: includeOwnerDetails ? share.manifest : publicManifest(share.manifest),
    mediaType: share.mediaType,
    mediaUrl: `/api/hype-card-shares/${share.publicToken}/media/${share.mediaType === "video" ? "video" : "poster"}`,
    videoUrl: share.mediaType === "video" ? `/api/hype-card-shares/${share.publicToken}/media/video` : null,
    posterUrl: `/api/hype-card-shares/${share.publicToken}/media/poster`,
    stats,
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
  });
}

async function ownedShareResponse(share: typeof hypeCardSharesTable.$inferSelect) {
  const response = await shareResponse(share, true);
  const expiresInDays = Math.max(
    1,
    Math.min(365, Math.round((share.expiresAt.getTime() - share.createdAt.getTime()) / (24 * 60 * 60 * 1000))),
  );
  return {
    ...response,
    trackerProjectId: share.trackerProjectId,
    athleteName: share.trackerProjectId ? share.athleteName : null,
    sport: share.trackerProjectId && isHypeCardSport(share.sport) ? share.sport : null,
    expiresInDays,
  };
}

async function deleteShareObjects(share: Pick<typeof hypeCardSharesTable.$inferSelect, "videoObjectPath" | "posterObjectPath">) {
  for (const objectPath of new Set([share.videoObjectPath, share.posterObjectPath])) {
    try {
      await objectStorage.deleteObjectEntity(objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }
}

router.post("/hype-card-shares/upload-url", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestHypeCardShareUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid share upload request" });
    return;
  }
  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const uploadUrl = await objectStorage.getObjectEntityUploadURL(parsed.data.contentType);
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadUrl);
    const expiresAt = new Date(Date.now() + UPLOAD_CLAIM_LIFETIME_MS);
    const [claim] = await db.insert(hypeCardShareUploadClaimsTable).values({
      ownerClerkUserId,
      mediaKind: parsed.data.mediaKind,
      objectPath,
      expiresAt,
    }).returning();
    res.json(RequestHypeCardShareUploadUrlResponse.parse({
      uploadUrl,
      objectPath,
      claimId: claim.id,
      expiresAt,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create Hype Card share upload URL");
    res.status(500).json({ error: "Unable to prepare share upload" });
  }
});

router.get("/hype-card-shares", requireAuth, async (_req, res): Promise<void> => {
  const shares = await db
    .select()
    .from(hypeCardSharesTable)
    .where(and(
      eq(hypeCardSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
      isNull(hypeCardSharesTable.revokedAt),
      gt(hypeCardSharesTable.expiresAt, new Date()),
    ))
    .orderBy(desc(hypeCardSharesTable.createdAt))
    .limit(25);
  res.json(ListHypeCardSharesResponse.parse(await Promise.all(shares.map(ownedShareResponse))));
});

router.post("/hype-card-shares", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateHypeCardShareBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid Hype Card share request");
    res.status(400).json({ error: "Invalid Hype Card share request" });
    return;
  }
  const manifestSize = Buffer.byteLength(JSON.stringify(parsed.data.manifest), "utf8");
  if (manifestSize > MAX_MANIFEST_BYTES) {
    res.status(413).json({ error: "The share design is too large. Remove the team logo and try again." });
    return;
  }

  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const { created, replaced } = await db.transaction(async (tx) => {
      const manifestShareKey = parsed.data.manifest && typeof parsed.data.manifest.shareKey === "string"
        ? parsed.data.manifest.shareKey
        : null;
      const shareKey = (parsed.data.shareKey ?? manifestShareKey)?.trim() || null;
      const claimIds = [parsed.data.mediaUploadClaimId, parsed.data.posterUploadClaimId].filter((id): id is string => Boolean(id));
      const claims = await tx.delete(hypeCardShareUploadClaimsTable)
        .where(and(
          eq(hypeCardShareUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
          gt(hypeCardShareUploadClaimsTable.expiresAt, new Date()),
          inArray(hypeCardShareUploadClaimsTable.id, [
            ...claimIds,
          ]),
        ))
        .returning();
      const mediaClaim = claims.find((claim) => claim.id === parsed.data.mediaUploadClaimId && claim.mediaKind === parsed.data.mediaType);
      const posterClaim = parsed.data.mediaType === "image"
        ? mediaClaim
        : claims.find((claim) => claim.id === parsed.data.posterUploadClaimId && claim.mediaKind === "poster");
      if (!mediaClaim || !posterClaim || claims.length !== (parsed.data.mediaType === "image" ? 1 : 2)
        || (parsed.data.mediaType === "video" && mediaClaim.objectPath === posterClaim.objectPath)) {
        throw new Error("UPLOAD_CLAIM_NOT_FOUND");
      }
      const [media, poster] = await Promise.all([
        objectStorage.getObjectEntityMetadata(mediaClaim.objectPath),
        objectStorage.getObjectEntityMetadata(posterClaim.objectPath),
      ]);
      if (parsed.data.mediaType === "video" &&
        (!["video/mp4", "video/webm"].includes(media.contentType) || media.size > MAX_VIDEO_BYTES)) {
        throw new Error("INVALID_VIDEO");
      }
      if (parsed.data.mediaType === "image" &&
        (!["image/jpeg", "image/png"].includes(media.contentType) || media.size > MAX_POSTER_BYTES)) {
        throw new Error("INVALID_IMAGE");
      }
      if (parsed.data.mediaType === "video" &&
        (!["image/jpeg", "image/png"].includes(poster.contentType) || poster.size > MAX_POSTER_BYTES)) {
        throw new Error("INVALID_POSTER");
      }
      let trackerProject: typeof cloudProjectsTable.$inferSelect | undefined;
      if (parsed.data.trackerProjectId) {
        if (!parsed.data.athleteName?.trim() || !parsed.data.sport) throw new Error("TRACKER_DETAILS_REQUIRED");
        [trackerProject] = await tx.select().from(cloudProjectsTable).where(and(
          eq(cloudProjectsTable.id, parsed.data.trackerProjectId),
          eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
        ));
        const projectData = trackerProject?.project;
        if (!trackerProject || !projectData || typeof projectData !== "object" || (projectData as { tool?: unknown }).tool !== "stat-tracker") {
          throw new Error("TRACKER_PROJECT_INVALID");
        }
      }
      const replaced: Array<typeof hypeCardSharesTable.$inferSelect> = [];
      if (parsed.data.replaceShareToken) {
        const [explicitReplacement] = await tx
          .update(hypeCardSharesTable)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(and(
            eq(hypeCardSharesTable.publicToken, parsed.data.replaceShareToken),
            eq(hypeCardSharesTable.ownerClerkUserId, ownerClerkUserId),
            isNull(hypeCardSharesTable.revokedAt),
            gt(hypeCardSharesTable.expiresAt, new Date()),
          ))
          .returning();
        if (!explicitReplacement) throw new Error("REPLACEMENT_NOT_FOUND");
        replaced.push(explicitReplacement);
      }
      if (shareKey) {
        const sameIdentity = await tx
          .update(hypeCardSharesTable)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(and(
            eq(hypeCardSharesTable.ownerClerkUserId, ownerClerkUserId),
            or(
              eq(hypeCardSharesTable.shareKey, shareKey),
              sql`${hypeCardSharesTable.shareKey} is null and ${hypeCardSharesTable.manifest}->>'shareKey' = ${shareKey}`,
            ),
            isNull(hypeCardSharesTable.revokedAt),
          ))
          .returning();
        replaced.push(...sameIdentity);
      }
      const [share] = await tx.insert(hypeCardSharesTable).values({
        ownerClerkUserId,
        publicToken: randomBytes(24).toString("base64url"),
        slug: parsed.data.slug,
        title: parsed.data.title,
        manifest: parsed.data.manifest,
        shareKey,
        mediaType: parsed.data.mediaType,
        videoObjectPath: mediaClaim.objectPath,
        videoContentType: media.contentType,
        videoSize: media.size,
        posterObjectPath: posterClaim.objectPath,
        posterContentType: poster.contentType,
        posterSize: poster.size,
        trackerProjectId: trackerProject?.id ?? null,
        athleteName: trackerProject ? parsed.data.athleteName?.trim() : null,
        sport: trackerProject ? parsed.data.sport : null,
        expiresAt: new Date(Date.now() + (parsed.data.expiresInDays ?? 30) * 24 * 60 * 60 * 1000),
      }).returning();
      return { created: share, replaced };
    });
    for (const oldShare of replaced) {
      try {
        await deleteShareObjects(oldShare);
        await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.id, oldShare.id));
      } catch (error) {
        req.log.warn({ err: error, shareId: oldShare.id }, "Hype Card link refreshed; deferred old media cleanup");
      }
    }
    res.status(201).json(await shareResponse(created));
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_CLAIM_NOT_FOUND") {
      res.status(409).json({ error: "Prepared share media has expired or is not owned by this account." });
      return;
    }
    if (error instanceof Error && error.message === "REPLACEMENT_NOT_FOUND") {
      res.status(409).json({ error: "The link being refreshed is no longer active. Reload the editor and try again." });
      return;
    }
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "Another link was published for this Hype Card. Reload the editor before trying again." });
      return;
    }
    if (error instanceof Error && error.message === "INVALID_VIDEO") {
      res.status(413).json({ error: "Prepared video must be an MP4 or WebM under 35MB." });
      return;
    }
    if (error instanceof Error && error.message === "INVALID_POSTER") {
      res.status(413).json({ error: "Poster must be a JPG or PNG under 5MB." });
      return;
    }
    if (error instanceof Error && error.message === "INVALID_IMAGE") {
      res.status(413).json({ error: "Image must be a JPG or PNG under 5MB." });
      return;
    }
    if (error instanceof Error && error.message === "TRACKER_DETAILS_REQUIRED") {
      res.status(400).json({ error: "athleteName and sport are required when linking a tracker project." });
      return;
    }
    if (error instanceof Error && error.message === "TRACKER_PROJECT_INVALID") {
      res.status(400).json({ error: "Tracker project not found or is not a stat-tracker project owned by this account." });
      return;
    }
    req.log.error({ err: error }, "Unable to create Hype Card share");
    res.status(500).json({ error: "Unable to create Hype Card share" });
  }
});

router.get("/hype-card-shares/:shareToken", async (req, res): Promise<void> => {
  const params = GetHypeCardShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Hype Card share not found" });
    return;
  }
  const [share] = await db.select().from(hypeCardSharesTable).where(activeShareWhere(params.data.shareToken));
  if (!share || !(await isAccountActive(share.ownerClerkUserId))) {
    res.status(404).json({ error: "Hype Card share not found" });
    return;
  }
  res.json(await shareResponse(share));
});

router.get("/hype-card-shares/:shareToken/media/:mediaKind", async (req, res): Promise<void> => {
  const params = ServeHypeCardShareMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Hype Card share media not found" });
    return;
  }
  const [share] = await db.select().from(hypeCardSharesTable).where(activeShareWhere(params.data.shareToken));
  if (!share || !(await isAccountActive(share.ownerClerkUserId))) {
    res.status(404).json({ error: "Hype Card share media not found" });
    return;
  }
  const objectPath = params.data.mediaKind === "video" ? share.videoObjectPath : share.posterObjectPath;
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const response = await objectStorage.downloadObject(file, 300);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", "inline");
    if (response.body) Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Hype Card share media not found" });
      return;
    }
    req.log.error({ err: error }, "Unable to serve Hype Card share media");
    res.status(500).json({ error: "Unable to serve Hype Card share media" });
  }
});

router.delete("/hype-card-shares/:shareToken", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteHypeCardShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Hype Card share not found" });
    return;
  }
  const [revoked] = await db
    .update(hypeCardSharesTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(hypeCardSharesTable.publicToken, params.data.shareToken),
      eq(hypeCardSharesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
    ))
    .returning();
  if (!revoked) {
    res.status(404).json({ error: "Hype Card share not found" });
    return;
  }
  try {
    await deleteShareObjects(revoked);
    await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.id, revoked.id));
  } catch (error) {
    req.log.warn({ err: error }, "Hype Card share revoked; deferred media cleanup");
  }
  res.status(204).send();
});

export default router;