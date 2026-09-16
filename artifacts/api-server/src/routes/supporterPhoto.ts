import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { and, eq, gt } from "drizzle-orm";
import {
  RequestSupporterPhotoUploadUrlBody,
  RequestSupporterPhotoUploadUrlResponse,
  SaveSupporterPhotoBody,
  SaveSupporterPhotoResponse,
} from "@workspace/api-zod";
import { db, supporterPhotosTable, supporterPhotoUploadClaimsTable } from "@workspace/db";
import { Router, type IRouter } from "express";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { isUsableSupporterPhotoClaim, replacedSupporterPhotoPath } from "../lib/supporterPhotoPolicy";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxSize = 5 * 1024 * 1024;

router.post("/supporter-photo/upload-url", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestSupporterPhotoUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !allowedTypes.has(parsed.data.contentType) || parsed.data.size > maxSize) {
    res.status(400).json({ error: "Choose a JPG, PNG, or WebP photo up to 5 MB." });
    return;
  }
  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const uploadUrl = await storage.getObjectEntityUploadURL(parsed.data.contentType);
    const objectPath = storage.normalizeObjectEntityPath(uploadUrl);
    await db.insert(supporterPhotoUploadClaimsTable).values({
      ownerClerkUserId,
      objectPath,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    res.json(RequestSupporterPhotoUploadUrlResponse.parse({
      uploadUrl,
      objectPath,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to prepare supporter photo upload");
    res.status(500).json({ error: "Unable to prepare photo upload." });
  }
});

router.post("/supporter-photo", requireAuth, async (req, res): Promise<void> => {
  const parsed = SaveSupporterPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid photo upload." });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  try {
    const [claim] = await db.select().from(supporterPhotoUploadClaimsTable).where(and(
      eq(supporterPhotoUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
      eq(supporterPhotoUploadClaimsTable.objectPath, parsed.data.objectPath),
      gt(supporterPhotoUploadClaimsTable.expiresAt, new Date()),
    ));
    if (!isUsableSupporterPhotoClaim(claim, ownerClerkUserId, parsed.data.objectPath)) {
      res.status(400).json({ error: "Photo upload expired. Choose the photo again." });
      return;
    }
    const metadata = await storage.getObjectEntityMetadata(parsed.data.objectPath);
    if (!allowedTypes.has(metadata.contentType)) {
      await storage.deleteObjectEntity(parsed.data.objectPath);
      res.status(400).json({ error: "Choose a JPG, PNG, or WebP photo." });
      return;
    }
    if (metadata.size > maxSize) {
      await storage.deleteObjectEntity(parsed.data.objectPath);
      res.status(413).json({ error: "Photo must be 5 MB or smaller." });
      return;
    }
    await storage.trySetObjectEntityAclPolicy(parsed.data.objectPath, {
      owner: ownerClerkUserId,
      visibility: "private",
    });
    const [previous] = await db.select().from(supporterPhotosTable)
      .where(eq(supporterPhotosTable.ownerClerkUserId, ownerClerkUserId));
    const [photo] = await db.insert(supporterPhotosTable).values({
      ownerClerkUserId,
      objectPath: parsed.data.objectPath,
      contentType: metadata.contentType,
      size: metadata.size,
      cropX: parsed.data.cropX,
      cropY: parsed.data.cropY,
      cropZoom: parsed.data.cropZoom,
    }).onConflictDoUpdate({
      target: supporterPhotosTable.ownerClerkUserId,
      set: {
        objectPath: parsed.data.objectPath,
        contentType: metadata.contentType,
        size: metadata.size,
        cropX: parsed.data.cropX,
        cropY: parsed.data.cropY,
        cropZoom: parsed.data.cropZoom,
        updatedAt: new Date(),
      },
    }).returning();
    const replacedPath = replacedSupporterPhotoPath(previous?.objectPath, photo.objectPath);
    if (replacedPath) {
      try { await storage.deleteObjectEntity(replacedPath); } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) req.log.warn({ err: error }, "Unable to delete replaced supporter photo");
      }
    }
    await db.delete(supporterPhotoUploadClaimsTable).where(eq(supporterPhotoUploadClaimsTable.id, claim.id));
    res.json(SaveSupporterPhotoResponse.parse({
      url: "/api/supporter-photo/image",
      contentType: photo.contentType,
      size: photo.size,
      cropX: photo.cropX,
      cropY: photo.cropY,
      cropZoom: photo.cropZoom,
      updatedAt: photo.updatedAt,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to save supporter photo");
    res.status(500).json({ error: "Unable to save photo." });
  }
});

router.get("/supporter-photo", requireAuth, async (_req, res): Promise<void> => {
  const [photo] = await db.select().from(supporterPhotosTable)
    .where(eq(supporterPhotosTable.ownerClerkUserId, getRequiredClerkUserId(res)));
  if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }
  res.json({
    url: "/api/supporter-photo/image",
    contentType: photo.contentType,
    size: photo.size,
    cropX: photo.cropX,
    cropY: photo.cropY,
    cropZoom: photo.cropZoom,
    updatedAt: photo.updatedAt,
  });
});

router.get("/supporter-photo/image", requireAuth, async (req, res): Promise<void> => {
  const [photo] = await db.select().from(supporterPhotosTable)
    .where(eq(supporterPhotosTable.ownerClerkUserId, getRequiredClerkUserId(res)));
  if (!photo) { res.status(404).end(); return; }
  try {
    const response = await storage.downloadObject(await storage.getObjectEntityFile(photo.objectPath), 300);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(404).end(); return; }
    req.log.error({ err: error }, "Unable to serve supporter photo");
    res.status(500).end();
  }
});

router.delete("/supporter-photo", requireAuth, async (req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [photo] = await db.delete(supporterPhotosTable)
    .where(eq(supporterPhotosTable.ownerClerkUserId, ownerClerkUserId)).returning();
  if (photo) {
    try { await storage.deleteObjectEntity(photo.objectPath); } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) req.log.warn({ err: error }, "Unable to delete supporter photo object");
    }
  }
  res.status(204).end();
});

export default router;