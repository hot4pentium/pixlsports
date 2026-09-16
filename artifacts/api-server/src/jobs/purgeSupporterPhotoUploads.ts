import { and, eq, lte } from "drizzle-orm";
import {
  db,
  supporterPhotosTable,
  supporterPhotoUploadClaimsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();
const INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 50;

export async function purgeExpiredSupporterPhotoUploads() {
  const now = new Date();
  const expiredClaims = await db
    .select()
    .from(supporterPhotoUploadClaimsTable)
    .where(lte(supporterPhotoUploadClaimsTable.expiresAt, now))
    .limit(BATCH_SIZE);

  for (const claim of expiredClaims) {
    const [removedClaim] = await db
      .delete(supporterPhotoUploadClaimsTable)
      .where(and(
        eq(supporterPhotoUploadClaimsTable.id, claim.id),
        lte(supporterPhotoUploadClaimsTable.expiresAt, now),
      ))
      .returning();

    if (!removedClaim) continue;

    const [activePhoto] = await db
      .select({ id: supporterPhotosTable.id })
      .from(supporterPhotosTable)
      .where(eq(supporterPhotosTable.objectPath, removedClaim.objectPath))
      .limit(1);

    if (activePhoto) continue;

    try {
      await objectStorage.deleteObjectEntity(removedClaim.objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) continue;

      logger.warn(
        { err: error, uploadClaimId: removedClaim.id },
        "Unable to purge abandoned supporter photo upload",
      );
      await db
        .insert(supporterPhotoUploadClaimsTable)
        .values(removedClaim)
        .onConflictDoNothing();
    }
  }
}

export function startSupporterPhotoUploadPurgeSchedule() {
  const run = () => void purgeExpiredSupporterPhotoUploads().catch((error) => {
    logger.error({ err: error }, "Expired supporter photo upload purge failed");
  });
  const initial = setTimeout(run, 15_000);
  const interval = setInterval(run, INTERVAL_MS);
  initial.unref();
  interval.unref();
}