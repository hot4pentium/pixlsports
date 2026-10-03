import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  CompleteProjectMediaUploadBody,
  DeleteProjectMediaParams,
  AbandonProjectMediaUploadParams,
  RequestProjectMediaUploadUrlBody,
  RequestProjectMediaUploadUrlResponse,
  CompleteProjectMediaUploadResponse,
  ServeProjectMediaParams,
} from "@workspace/api-zod";
import {
  cloudProjectsTable,
  db,
  projectMediaTable,
  projectMediaUploadClaimsTable,
} from "@workspace/db";
import { Router, type IRouter } from "express";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { hasActivePaidEntitlement, PROJECT_MEDIA_QUOTA_BYTES } from "../lib/accountLifecycle";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const CLAIM_LIFETIME_MS = 15 * 60 * 1000;
const ROLE_LIMITS: Record<string, { type: "image" | "video"; max: number; types: Set<string> }> = {
  photo: { type: "image", max: 10 * 1024 * 1024, types: new Set(["image/jpeg", "image/png", "image/webp"]) },
  logo: { type: "image", max: 10 * 1024 * 1024, types: new Set(["image/jpeg", "image/png", "image/webp"]) },
  poster: { type: "image", max: 10 * 1024 * 1024, types: new Set(["image/jpeg", "image/png", "image/webp"]) },
  cutout: { type: "image", max: 10 * 1024 * 1024, types: new Set(["image/png", "image/webp"]) },
  video_preview: { type: "video", max: 25 * 1024 * 1024, types: new Set(["video/mp4", "video/webm"]) },
  video_download: { type: "video", max: 80 * 1024 * 1024, types: new Set(["video/mp4", "video/webm"]) },
};

function rolePolicy(role: string) {
  return ROLE_LIMITS[role];
}

async function deleteObjectQuietly(path: string, log: { warn: (obj: unknown, msg: string) => void }) {
  try {
    await objectStorageService.deleteObjectEntity(path);
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) log.warn({ err: error, objectPath: path }, "Unable to delete project media object");
  }
}

router.post("/storage/uploads/request-url", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestProjectMediaUploadUrlBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  if (!(await hasActivePaidEntitlement(ownerClerkUserId))) {
    res.status(403).json({ error: "An active paid entitlement is required for cloud media." }); return;
  }
  const policy = rolePolicy(parsed.data.mediaRole);
  if (!policy || parsed.data.mediaType !== policy.type || !policy.types.has(parsed.data.contentType) || parsed.data.size > policy.max) {
    res.status(413).json({ error: "The selected media type or size is not supported." }); return;
  }
  if (parsed.data.projectId) {
    const [project] = await db.select({ id: cloudProjectsTable.id }).from(cloudProjectsTable).where(and(
      eq(cloudProjectsTable.id, parsed.data.projectId),
      eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
    ));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(parsed.data.contentType);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const [claim] = await db.insert(projectMediaUploadClaimsTable).values({
      ownerClerkUserId,
      projectId: parsed.data.projectId ?? null,
      name: parsed.data.name,
      contentType: parsed.data.contentType,
      mediaRole: parsed.data.mediaRole,
      size: parsed.data.size,
      objectPath,
      expiresAt: new Date(Date.now() + CLAIM_LIFETIME_MS),
    }).returning();
    res.json(RequestProjectMediaUploadUrlResponse.parse({ uploadURL, objectPath, claimId: claim.id, expiresAt: claim.expiresAt }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to prepare project media upload");
    res.status(500).json({ error: "Unable to prepare media upload." });
  }
});

router.post("/storage/uploads/complete", requireAuth, async (req, res): Promise<void> => {
  const parsed = CompleteProjectMediaUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  if (!(await hasActivePaidEntitlement(ownerClerkUserId))) { res.status(403).json({ error: "An active paid entitlement is required for cloud media." }); return; }
  let replacementPath: string | null = null;
  let created: typeof projectMediaTable.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerClerkUserId}))`);
      const [claim] = await tx.select().from(projectMediaUploadClaimsTable).where(and(
        eq(projectMediaUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
        eq(projectMediaUploadClaimsTable.objectPath, parsed.data.objectPath),
        gt(projectMediaUploadClaimsTable.expiresAt, new Date()),
      ));
      if (!claim) throw new Error("CLAIM_EXPIRED");
      const policy = rolePolicy(claim.mediaRole);
      if (!policy) throw new Error("INVALID_ROLE");
      const metadata = await objectStorageService.getObjectEntityMetadata(claim.objectPath);
      if (metadata.contentType !== claim.contentType || !policy.types.has(metadata.contentType) || metadata.size !== claim.size || metadata.size > policy.max) throw new Error("INVALID_MEDIA");
      const [{ value }] = await tx.select({ value: sql<number>`coalesce(sum(${projectMediaTable.size}), 0)` }).from(projectMediaTable).where(eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId));
      const old = claim.projectId ? (await tx.select().from(projectMediaTable).where(and(
        eq(projectMediaTable.projectId, claim.projectId),
        eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
        eq(projectMediaTable.mediaRole, claim.mediaRole),
      )))[0] : undefined;
      const used = Number(value) - (old?.size ?? 0);
      if (used + metadata.size > PROJECT_MEDIA_QUOTA_BYTES) throw new Error("QUOTA_EXCEEDED");
      await objectStorageService.trySetObjectEntityAclPolicy(claim.objectPath, { owner: ownerClerkUserId, visibility: "private" });
      if (old) {
        replacementPath = old.objectPath;
        await tx.delete(projectMediaTable).where(eq(projectMediaTable.id, old.id));
      }
      const [media] = await tx.insert(projectMediaTable).values({
        ownerClerkUserId,
        projectId: claim.projectId,
        objectPath: claim.objectPath,
        name: claim.name,
        contentType: metadata.contentType,
        mediaType: policy.type,
        mediaRole: claim.mediaRole,
        size: metadata.size,
      }).returning();
      await tx.delete(projectMediaUploadClaimsTable).where(eq(projectMediaUploadClaimsTable.id, claim.id));
      return media;
    });
    if (replacementPath && replacementPath !== created.objectPath) await deleteObjectQuietly(replacementPath, req.log);
    const response = { ...created };
    delete (response as { objectPath?: string }).objectPath;
    res.status(201).json(CompleteProjectMediaUploadResponse.parse(response));
  } catch (error) {
    if (error instanceof Error && error.message === "CLAIM_EXPIRED") { res.status(409).json({ error: "Upload claim expired or was already consumed." }); return; }
    if (error instanceof Error && error.message === "QUOTA_EXCEEDED") { await deleteObjectQuietly(parsed.data.objectPath, req.log); res.status(409).json({ error: "Cloud media storage quota reached." }); return; }
    if (error instanceof Error && (error.message === "INVALID_MEDIA" || error.message === "INVALID_ROLE")) { await deleteObjectQuietly(parsed.data.objectPath, req.log); res.status(413).json({ error: "Uploaded media does not match its declared type or size." }); return; }
    req.log.error({ err: error }, "Unable to complete project media upload");
    res.status(500).json({ error: "Unable to save project media." });
  }
});

router.delete("/storage/uploads/:claimId", requireAuth, async (req, res): Promise<void> => {
  const params = AbandonProjectMediaUploadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerClerkUserId}))`);
      const [claim] = await tx.select().from(projectMediaUploadClaimsTable).where(and(
        eq(projectMediaUploadClaimsTable.id, params.data.claimId),
        eq(projectMediaUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
      ));
      if (!claim) throw new Error("CLAIM_NOT_FOUND");

      const [attached] = await tx.select({ id: projectMediaTable.id }).from(projectMediaTable).where(and(
        eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
        eq(projectMediaTable.objectPath, claim.objectPath),
      ));
      if (attached) throw new Error("CLAIM_ATTACHED");

      try {
        await objectStorageService.deleteObjectEntity(claim.objectPath);
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw new Error("OBJECT_DELETE_FAILED", { cause: error });
      }
      await tx.delete(projectMediaUploadClaimsTable).where(and(
        eq(projectMediaUploadClaimsTable.id, claim.id),
        eq(projectMediaUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
      ));
    });
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof Error && error.message === "CLAIM_NOT_FOUND") {
      res.status(404).json({ error: "Upload claim not found" });
      return;
    }
    if (error instanceof Error && error.message === "CLAIM_ATTACHED") {
      res.status(409).json({ error: "Upload is already attached to project media." });
      return;
    }
    if (error instanceof Error && error.message === "OBJECT_DELETE_FAILED") {
      req.log.error({ err: error.cause, claimId: params.data.claimId }, "Unable to remove abandoned project media object");
      res.status(500).json({ error: "Unable to remove abandoned media. Please retry." });
      return;
    }
    req.log.error({ err: error, claimId: params.data.claimId }, "Unable to abandon project media upload");
    res.status(500).json({ error: "Unable to clean up abandoned media." });
  }
});

router.delete("/storage/media/:mediaId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteProjectMediaParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [media] = await db.delete(projectMediaTable).where(and(eq(projectMediaTable.id, params.data.mediaId), eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId))).returning();
  if (!media) { res.status(404).json({ error: "Media not found" }); return; }
  await deleteObjectQuietly(media.objectPath, req.log);
  res.sendStatus(204);
});

router.get("/storage/media/:mediaId", requireAuth, async (req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const params = ServeProjectMediaParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [media] = await db.select().from(projectMediaTable).where(and(eq(projectMediaTable.id, params.data.mediaId), eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId)));
  if (!media) { res.status(404).json({ error: "Media not found" }); return; }
  try {
    const file = await objectStorageService.getObjectEntityFile(media.objectPath);
    const range = req.get("range");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", media.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", "inline");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${media.size}`).end();
        return;
      }
      const requestedStart = match[1] ? Number(match[1]) : null;
      const requestedEnd = match[2] ? Number(match[2]) : null;
      const start = requestedStart ?? Math.max(0, media.size - (requestedEnd ?? 0));
      const end = requestedStart === null
        ? media.size - 1
        : Math.min(requestedEnd ?? media.size - 1, media.size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= media.size) {
        res.status(416).setHeader("Content-Range", `bytes */${media.size}`).end();
        return;
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${media.size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      file.createReadStream({ start, end }).pipe(res);
      return;
    }
    const response = await objectStorageService.downloadObject(file, 300);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(404).json({ error: "Media object not found" }); return; }
    req.log.error({ err: error, mediaId: media.id }, "Error serving project media");
    res.status(500).json({ error: "Failed to serve media" });
  }
});

export default router;