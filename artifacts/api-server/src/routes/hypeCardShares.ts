import { randomBytes } from "crypto";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
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
import { db, hypeCardSharesTable, hypeCardShareUploadClaimsTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isAccountActive } from "../lib/accountLifecycle";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const SHARE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
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

function shareResponse(share: typeof hypeCardSharesTable.$inferSelect) {
  return CreateHypeCardShareResponse.parse({
    shareToken: share.publicToken,
    slug: share.slug,
    title: share.title,
    manifest: share.manifest,
    videoUrl: `/api/hype-card-shares/${share.publicToken}/media/video`,
    posterUrl: `/api/hype-card-shares/${share.publicToken}/media/poster`,
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
  });
}

async function deleteShareObjects(share: Pick<typeof hypeCardSharesTable.$inferSelect, "videoObjectPath" | "posterObjectPath">) {
  for (const objectPath of [share.videoObjectPath, share.posterObjectPath]) {
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
  res.json(ListHypeCardSharesResponse.parse(shares.map(shareResponse)));
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
    const created = await db.transaction(async (tx) => {
      const claims = await tx.delete(hypeCardShareUploadClaimsTable)
        .where(and(
          eq(hypeCardShareUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
          gt(hypeCardShareUploadClaimsTable.expiresAt, new Date()),
          inArray(hypeCardShareUploadClaimsTable.id, [
            parsed.data.videoUploadClaimId,
            parsed.data.posterUploadClaimId,
          ]),
        ))
        .returning();
      const videoClaim = claims.find((claim) =>
        claim.id === parsed.data.videoUploadClaimId && claim.mediaKind === "video");
      const posterClaim = claims.find((claim) =>
        claim.id === parsed.data.posterUploadClaimId && claim.mediaKind === "poster");
      if (!videoClaim || !posterClaim || claims.length !== 2) {
        throw new Error("UPLOAD_CLAIM_NOT_FOUND");
      }
      const [video, poster] = await Promise.all([
        objectStorage.getObjectEntityMetadata(videoClaim.objectPath),
        objectStorage.getObjectEntityMetadata(posterClaim.objectPath),
      ]);
      if (!["video/mp4", "video/webm"].includes(video.contentType) || video.size > MAX_VIDEO_BYTES) {
        throw new Error("INVALID_VIDEO");
      }
      if (!["image/jpeg", "image/png"].includes(poster.contentType) || poster.size > MAX_POSTER_BYTES) {
        throw new Error("INVALID_POSTER");
      }
      const [share] = await tx.insert(hypeCardSharesTable).values({
        ownerClerkUserId,
        publicToken: randomBytes(24).toString("base64url"),
        slug: parsed.data.slug,
        title: parsed.data.title,
        manifest: parsed.data.manifest,
        videoObjectPath: videoClaim.objectPath,
        videoContentType: video.contentType,
        videoSize: video.size,
        posterObjectPath: posterClaim.objectPath,
        posterContentType: poster.contentType,
        posterSize: poster.size,
        expiresAt: new Date(Date.now() + SHARE_LIFETIME_MS),
      }).returning();
      return share;
    });
    res.status(201).json(shareResponse(created));
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_CLAIM_NOT_FOUND") {
      res.status(409).json({ error: "Prepared share media has expired or is not owned by this account." });
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
  res.json(shareResponse(share));
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