import { eq, isNotNull, lte, or } from "drizzle-orm";
import { db, hypeCardSharesTable, hypeCardShareUploadClaimsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();
const INTERVAL_MS = 60 * 60 * 1000;

export async function purgeExpiredHypeCardShares() {
  const abandonedUploads = await db.delete(hypeCardShareUploadClaimsTable)
    .where(lte(hypeCardShareUploadClaimsTable.expiresAt, new Date()))
    .returning();
  for (const claim of abandonedUploads) {
    try {
      await objectStorage.deleteObjectEntity(claim.objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) {
        logger.warn({ err: error, uploadClaimId: claim.id }, "Unable to purge abandoned Hype Card upload");
        await db.insert(hypeCardShareUploadClaimsTable).values(claim).onConflictDoNothing();
      }
    }
  }
  const expired = await db
    .select()
    .from(hypeCardSharesTable)
    .where(or(
      lte(hypeCardSharesTable.expiresAt, new Date()),
      isNotNull(hypeCardSharesTable.revokedAt),
    ))
    .limit(50);
  for (const share of expired) {
    try {
      for (const objectPath of [share.videoObjectPath, share.posterObjectPath]) {
        try {
          await objectStorage.deleteObjectEntity(objectPath);
        } catch (error) {
          if (!(error instanceof ObjectNotFoundError)) throw error;
        }
      }
      await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.id, share.id));
    } catch (error) {
      logger.warn({ err: error, shareId: share.id }, "Unable to purge expired Hype Card share");
    }
  }
}

export function startHypeCardSharePurgeSchedule() {
  const run = () => void purgeExpiredHypeCardShares().catch((error) => {
    logger.error({ err: error }, "Expired Hype Card share purge failed");
  });
  const initial = setTimeout(run, 15_000);
  const interval = setInterval(run, INTERVAL_MS);
  initial.unref();
  interval.unref();
}