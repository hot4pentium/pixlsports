import { and, eq } from "drizzle-orm";
import { db, projectMediaTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export class ProjectMediaValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProjectMediaValidationError";
    this.status = status;
  }
}

export async function validateProjectMediaClaim({
  mediaId,
  ownerClerkUserId,
  projectId,
  objectStorageService,
}: {
  mediaId: string;
  ownerClerkUserId: string;
  projectId?: string;
  objectStorageService: ObjectStorageService;
}) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      mediaId,
    )
  ) {
    throw new ProjectMediaValidationError("Invalid project media reference");
  }

  const [media] = await db
    .select()
    .from(projectMediaTable)
    .where(
      and(
        eq(projectMediaTable.id, mediaId),
        eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
      ),
    );
  if (!media) {
    throw new ProjectMediaValidationError("Project media is not available");
  }
  if (media.projectId !== null && media.projectId !== projectId) {
    throw new ProjectMediaValidationError(
      "Project media is already assigned to another project",
    );
  }

  const maxBytes =
    media.mediaType === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const trackedContentType = media.contentType.toLowerCase();
  if (
    (media.mediaType !== "image" && media.mediaType !== "video") ||
    !trackedContentType.startsWith(`${media.mediaType}/`) ||
    media.size < 1 ||
    media.size > maxBytes
  ) {
    throw new ProjectMediaValidationError("Tracked project media metadata is invalid");
  }

  let actual;
  try {
    actual = await objectStorageService.getObjectEntityMetadata(media.objectPath);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      throw new ProjectMediaValidationError("Project media object is not uploaded");
    }
    throw error;
  }
  if (
    actual.size !== media.size ||
    actual.contentType !== trackedContentType ||
    !actual.contentType.startsWith(`${media.mediaType}/`) ||
    actual.size > maxBytes
  ) {
    throw new ProjectMediaValidationError(
      "Uploaded project media does not match its declared metadata",
    );
  }

  return media;
}