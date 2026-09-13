import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { and, eq } from "drizzle-orm";
import {
  RequestProjectMediaUploadUrlBody,
  RequestProjectMediaUploadUrlResponse,
  ServeProjectMediaParams,
} from "@workspace/api-zod";
import { db, cloudProjectsTable, projectMediaTable } from "@workspace/db";
import { Router, type IRouter } from "express";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "../lib/projectMediaValidation";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
function isAllowedContentType(mediaType: "image" | "video", contentType: string): boolean {
  return contentType.startsWith(`${mediaType}/`);
}

router.post(
  "/storage/uploads/request-url",
  requireAuth,
  async (req, res): Promise<void> => {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const parsed = RequestProjectMediaUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.issues }, "Invalid media upload request");
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { projectId, name, size, mediaType } = parsed.data;
    const contentType = parsed.data.contentType.toLowerCase();
    const maxBytes = mediaType === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (!isAllowedContentType(mediaType, contentType)) {
      res.status(400).json({ error: `contentType must be ${mediaType}/*` });
      return;
    }
    if (size > maxBytes) {
      res.status(413).json({ error: `File exceeds the ${maxBytes} byte limit` });
      return;
    }

    if (projectId) {
      const [project] = await db
        .select({ id: cloudProjectsTable.id })
        .from(cloudProjectsTable)
        .where(
          and(
            eq(cloudProjectsTable.id, projectId),
            eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
          ),
        );
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
    }

    try {
      const uploadURL =
        await objectStorageService.getObjectEntityUploadURL(contentType);
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      const [media] = await db
        .insert(projectMediaTable)
        .values({
          ownerClerkUserId,
          projectId: projectId ?? null,
          objectPath,
          name,
          contentType,
          mediaType,
          size,
        })
        .returning({
          id: projectMediaTable.id,
          objectPath: projectMediaTable.objectPath,
          name: projectMediaTable.name,
          contentType: projectMediaTable.contentType,
          size: projectMediaTable.size,
          mediaType: projectMediaTable.mediaType,
          createdAt: projectMediaTable.createdAt,
        });

      res.json(
        RequestProjectMediaUploadUrlResponse.parse({
          id: media.id,
          uploadURL,
          objectPath,
          media,
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating project media upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

router.get(
  "/storage/media/:mediaId",
  requireAuth,
  async (req, res): Promise<void> => {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const params = ServeProjectMediaParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [media] = await db
      .select()
      .from(projectMediaTable)
      .where(
        and(
          eq(projectMediaTable.id, params.data.mediaId),
          eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
        ),
      );
    if (!media) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    try {
      const objectFile = await objectStorageService.getObjectEntityFile(media.objectPath);
      const response = await objectStorageService.downloadObject(objectFile, 300);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Media object not found" });
        return;
      }
      req.log.error({ err: error, mediaId: media.id }, "Error serving project media");
      res.status(500).json({ error: "Failed to serve media" });
    }
  },
);

export default router;