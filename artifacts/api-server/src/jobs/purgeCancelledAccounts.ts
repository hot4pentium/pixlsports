import { createClerkClient } from "@clerk/express";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import {
  accountAccessTable,
  cloudProjectsTable,
  db,
  guestUsageEventsTable,
  hypeCardSharesTable,
  projectMediaTable,
  projectMediaUploadClaimsTable,
  scheduleSharesTable,
  statTrackerSharesTable,
  supporterPhotosTable,
  supporterPhotoUploadClaimsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const PURGE_BATCH_SIZE = 25;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_LEASE_MS = 15 * 60 * 1000;
const objectStorage = new ObjectStorageService();

export type AccountPurgeDependencies = {
  deleteObject: (objectPath: string) => Promise<void>;
  deleteClerkUser: (clerkUserId: string) => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unknown purge error";
}

function isClerkNotFound(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && (error as { status?: unknown }).status === 404;
}

async function claimAccount(accountId: string) {
  const now = new Date();
  const staleLease = new Date(now.getTime() - PURGE_LEASE_MS);
  const [claimed] = await db
    .update(accountAccessTable)
    .set({
      lifecycleStatus: "deletion_pending",
      purgeStartedAt: now,
      purgeError: null,
      updatedAt: now,
    })
    .where(and(
      eq(accountAccessTable.id, accountId),
      or(
        and(
          eq(accountAccessTable.lifecycleStatus, "cancelled"),
          lte(accountAccessTable.deletionEligibleAt, now),
        ),
        and(
          eq(accountAccessTable.lifecycleStatus, "deletion_pending"),
          or(isNull(accountAccessTable.purgeStartedAt), lte(accountAccessTable.purgeStartedAt, staleLease)),
        ),
      ),
    ))
    .returning();
  return claimed;
}

function defaultPurgeDependencies(): AccountPurgeDependencies {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required for account purging");
  const clerk = createClerkClient({ secretKey });
  return {
    deleteObject: (objectPath) => objectStorage.deleteObjectEntity(objectPath),
    deleteClerkUser: (clerkUserId) => clerk.users.deleteUser(clerkUserId).then(() => undefined),
  };
}

async function purgeAccount(
  account: typeof accountAccessTable.$inferSelect,
  dependencies: AccountPurgeDependencies,
) {
  const media = await db
    .select({ objectPath: projectMediaTable.objectPath })
    .from(projectMediaTable)
    .where(eq(projectMediaTable.ownerClerkUserId, account.ownerClerkUserId));
  const uploadClaims = await db
    .select({ objectPath: projectMediaUploadClaimsTable.objectPath })
    .from(projectMediaUploadClaimsTable)
    .where(eq(projectMediaUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
  const hypeShares = await db
    .select({
      videoObjectPath: hypeCardSharesTable.videoObjectPath,
      posterObjectPath: hypeCardSharesTable.posterObjectPath,
    })
    .from(hypeCardSharesTable)
    .where(eq(hypeCardSharesTable.ownerClerkUserId, account.ownerClerkUserId));
  const supporterPhotos = await db
    .select({ objectPath: supporterPhotosTable.objectPath })
    .from(supporterPhotosTable)
    .where(eq(supporterPhotosTable.ownerClerkUserId, account.ownerClerkUserId));

  for (const item of media) {
    try {
      await dependencies.deleteObject(item.objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }
  for (const item of uploadClaims) {
    try {
      await dependencies.deleteObject(item.objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }
  for (const share of hypeShares) {
    for (const objectPath of [share.videoObjectPath, share.posterObjectPath]) {
      if (!objectPath) continue;
      try {
        await dependencies.deleteObject(objectPath);
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw error;
      }
    }
  }
  for (const photo of supporterPhotos) {
    try {
      await dependencies.deleteObject(photo.objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(projectMediaTable).where(eq(projectMediaTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(projectMediaUploadClaimsTable).where(eq(projectMediaUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(scheduleSharesTable).where(eq(scheduleSharesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(guestUsageEventsTable).where(eq(guestUsageEventsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(supporterPhotosTable).where(eq(supporterPhotosTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(supporterPhotoUploadClaimsTable).where(eq(supporterPhotoUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
  });

  try {
    await dependencies.deleteClerkUser(account.ownerClerkUserId);
  } catch (error) {
    if (!isClerkNotFound(error)) throw error;
  }

  await db.delete(accountAccessTable).where(eq(accountAccessTable.id, account.id));
}

export async function runExpiredAccountPurge(
  options: {
    dependencies?: AccountPurgeDependencies;
    batchSize?: number;
    ownerClerkUserId?: string;
  } = {},
) {
  const dependencies = options.dependencies ?? defaultPurgeDependencies();
  const now = new Date();
  const staleLease = new Date(now.getTime() - PURGE_LEASE_MS);
  const eligibleForPurge = or(
    and(
      eq(accountAccessTable.lifecycleStatus, "cancelled"),
      lte(accountAccessTable.deletionEligibleAt, now),
    ),
    and(
      eq(accountAccessTable.lifecycleStatus, "deletion_pending"),
      or(isNull(accountAccessTable.purgeStartedAt), lte(accountAccessTable.purgeStartedAt, staleLease)),
    ),
  );
  const candidates = await db
    .select({ id: accountAccessTable.id })
    .from(accountAccessTable)
    .where(options.ownerClerkUserId
      ? and(eq(accountAccessTable.ownerClerkUserId, options.ownerClerkUserId), eligibleForPurge)
      : eligibleForPurge)
    .limit(options.batchSize ?? PURGE_BATCH_SIZE);

  for (const candidate of candidates) {
    const account = await claimAccount(candidate.id);
    if (!account) continue;
    try {
      await purgeAccount(account, dependencies);
      logger.info({ clerkUserId: account.ownerClerkUserId }, "Purged expired LeagueMatrix account");
    } catch (error) {
      logger.error({ err: error, clerkUserId: account.ownerClerkUserId }, "Unable to purge expired LeagueMatrix account");
      await db
        .update(accountAccessTable)
        .set({
          purgeStartedAt: null,
          purgeError: errorMessage(error),
          updatedAt: new Date(),
        })
        .where(eq(accountAccessTable.id, account.id));
    }
  }
}

export function startExpiredAccountPurgeSchedule() {
  const run = () => {
    void runExpiredAccountPurge().catch((error) => {
      logger.error({ err: error }, "Expired account purge job failed");
    });
  };
  const initialTimer = setTimeout(run, 10_000);
  const interval = setInterval(run, PURGE_INTERVAL_MS);
  initialTimer.unref();
  interval.unref();
}