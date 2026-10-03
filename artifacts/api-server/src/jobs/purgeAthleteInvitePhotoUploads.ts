import { and, eq, lte, or } from "drizzle-orm";
import {
  athleteInvitePhotoUploadClaimsTable,
  athleteInvitesTable,
  db,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();
const INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 50;

export async function purgeExpiredAthleteInvitePhotoUploads() {
  const now = new Date();
  const expiredClaims = await db.select().from(athleteInvitePhotoUploadClaimsTable)
    .where(lte(athleteInvitePhotoUploadClaimsTable.expiresAt, now))
    .limit(BATCH_SIZE);
  for (const claim of expiredClaims) {
    const [removedClaim] = await db.delete(athleteInvitePhotoUploadClaimsTable).where(and(
      eq(athleteInvitePhotoUploadClaimsTable.id, claim.id),
      lte(athleteInvitePhotoUploadClaimsTable.expiresAt, now),
    )).returning();
    if (!removedClaim) continue;

    const [activePhoto] = await db.select({ id: athleteInvitesTable.id })
      .from(athleteInvitesTable)
      .where(or(eq(athleteInvitesTable.photoObjectPath, removedClaim.objectPath), eq(athleteInvitesTable.cutoutObjectPath, removedClaim.objectPath)))
      .limit(1);
    if (activePhoto) continue;
    try {
      await objectStorage.deleteObjectEntity(removedClaim.objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) continue;
      logger.warn({ err: error, claimId: removedClaim.id }, "Unable to purge expired athlete photo upload");
      await db.insert(athleteInvitePhotoUploadClaimsTable).values(removedClaim).onConflictDoNothing();
    }
  }
}

export function startAthleteInvitePhotoUploadPurgeSchedule() {
  const run = () => void purgeExpiredAthleteInvitePhotoUploads().catch((error) => {
    logger.error({ err: error }, "Expired athlete photo upload purge failed");
  });
  const initial = setTimeout(run, 15_000);
  const interval = setInterval(run, INTERVAL_MS);
  initial.unref();
  interval.unref();
}