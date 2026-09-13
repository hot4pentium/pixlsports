import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { and, eq } from "drizzle-orm";
import { ServeProjectMediaParams } from "@workspace/api-zod";
import { db, projectMediaTable } from "@workspace/db";
import { Router, type IRouter } from "express";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.post(
  "/storage/uploads/request-url",
  requireAuth,
  (_req, res): void => {
    res.status(410).json({
      error: "Cloud media uploads are disabled. Saved projects contain design settings only.",
    });
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