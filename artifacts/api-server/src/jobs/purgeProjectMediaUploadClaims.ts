import { and, eq, lte } from "drizzle-orm";
import { db, projectMediaUploadClaimsTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const objectStorage = new ObjectStorageService();
const INTERVAL_MS = 15 * 60 * 1000;

export async function purgeExpiredProjectMediaUploadClaims() {
  const claims = await db.select().from(projectMediaUploadClaimsTable)
    .where(lte(projectMediaUploadClaimsTable.expiresAt, new Date()));
  for (const claim of claims) {
    try {
      await objectStorage.deleteObjectEntity(claim.objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) {
        logger.warn({ err: error, objectPath: claim.objectPath }, "Unable to delete expired project media claim object");
      }
    }
    await db.delete(projectMediaUploadClaimsTable).where(
      and(
        eq(projectMediaUploadClaimsTable.id, claim.id),
        lte(projectMediaUploadClaimsTable.expiresAt, new Date()),
      ),
    );
  }
}

export function startProjectMediaUploadClaimPurgeSchedule() {
  const run = () => void purgeExpiredProjectMediaUploadClaims().catch((error) => {
    logger.error({ err: error }, "Project media upload claim purge failed");
  });
  const initial = setTimeout(run, 10_000);
  const interval = setInterval(run, INTERVAL_MS);
  initial.unref();
  interval.unref();
}