import { createClerkClient } from "@clerk/express";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  accountEntitlementEventsTable,
  accountAccessTable,
  adminActionAuditTable,
  adminUsersTable,
  athleteInviteEventDeliveryClaimsTable,
  athleteInviteFanDeliveriesTable,
  athleteInviteFanRateLimitsTable,
  athleteInviteFansTable,
  athleteInviteEventLinksTable,
  athleteInvitePhotoUploadClaimsTable,
  athleteInvitesTable,
  checklistSharesTable,
  cloudProjectsTable,
  db,
  gameOnReminderSyncTable,
  gameOnScheduledRemindersTable,
  guestUsageEventsTable,
  hypeCardSharesTable,
  hypeCardShareUploadClaimsTable,
  meetingWorkspacesTable,
  plannerNotificationPreferencesTable,
  plannerOwnerEventAlertClaimsTable,
  projectMediaTable,
  projectMediaUploadClaimsTable,
  scheduleSharesTable,
  statTrackerSharesTable,
  supporterActiveGamesTable,
  supporterPhotosTable,
  supporterPhotoUploadClaimsTable,
  webPushSubscriptionsTable,
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
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({
      ownerClerkUserId: accountAccessTable.ownerClerkUserId,
    }).from(accountAccessTable)
      .where(eq(accountAccessTable.id, accountId))
      .limit(1);
    if (!existing) return undefined;

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${existing.ownerClerkUserId}, 0))`);
    const [administrator] = await tx.select({ clerkUserId: adminUsersTable.clerkUserId })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.clerkUserId, existing.ownerClerkUserId))
      .limit(1);
    if (administrator) return undefined;

    const [claimed] = await tx
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
  });
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
  const invites = await db
    .select({ id: athleteInvitesTable.id, photoObjectPath: athleteInvitesTable.photoObjectPath })
    .from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.ownerClerkUserId, account.ownerClerkUserId));
  const invitePhotoClaims = await db
    .select({ objectPath: athleteInvitePhotoUploadClaimsTable.objectPath })
    .from(athleteInvitePhotoUploadClaimsTable)
    .where(eq(athleteInvitePhotoUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
  const supporterPhotoClaims = await db
    .select({ objectPath: supporterPhotoUploadClaimsTable.objectPath })
    .from(supporterPhotoUploadClaimsTable)
    .where(eq(supporterPhotoUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
  const hypeUploadClaims = await db
    .select({ objectPath: hypeCardShareUploadClaimsTable.objectPath })
    .from(hypeCardShareUploadClaimsTable)
    .where(eq(hypeCardShareUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
  const ownedScheduleShares = await db
    .select({ id: scheduleSharesTable.id })
    .from(scheduleSharesTable)
    .where(eq(scheduleSharesTable.ownerClerkUserId, account.ownerClerkUserId));
  const scheduleShareIds = ownedScheduleShares.map((share) => share.id);
  const inviteIds = invites.map((invite) => invite.id);

  const ownedObjectPaths = new Set([
    ...media.map((item) => item.objectPath),
    ...uploadClaims.map((item) => item.objectPath),
    ...hypeUploadClaims.map((item) => item.objectPath),
    ...supporterPhotos.map((photo) => photo.objectPath),
    ...supporterPhotoClaims.map((claim) => claim.objectPath),
    ...hypeShares.flatMap((share) => [share.videoObjectPath, share.posterObjectPath]
      .filter((objectPath): objectPath is string => Boolean(objectPath))),
    ...invites.flatMap((invite) => invite.photoObjectPath ? [invite.photoObjectPath] : []),
    ...invitePhotoClaims.map((claim) => claim.objectPath),
  ]);
  for (const objectPath of ownedObjectPaths) {
    try {
      await dependencies.deleteObject(objectPath);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }

  await db.transaction(async (tx) => {
    const relatedDeliveryConditions = [
      ...(inviteIds.length ? [inArray(athleteInviteEventDeliveryClaimsTable.inviteId, inviteIds)] : []),
      ...(scheduleShareIds.length ? [inArray(athleteInviteEventDeliveryClaimsTable.shareId, scheduleShareIds)] : []),
    ];
    if (relatedDeliveryConditions.length) {
      await tx.delete(athleteInviteEventDeliveryClaimsTable)
        .where(relatedDeliveryConditions.length === 1 ? relatedDeliveryConditions[0] : or(...relatedDeliveryConditions));
    }
    if (inviteIds.length) {
      await tx.delete(athleteInviteEventLinksTable)
        .where(inArray(athleteInviteEventLinksTable.inviteId, inviteIds));
    }
    await tx.delete(accountEntitlementEventsTable)
      .where(eq(accountEntitlementEventsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(projectMediaTable).where(eq(projectMediaTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(projectMediaUploadClaimsTable).where(eq(projectMediaUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(hypeCardShareUploadClaimsTable)
      .where(eq(hypeCardShareUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(scheduleSharesTable).where(eq(scheduleSharesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, account.ownerClerkUserId));
    if (inviteIds.length) {
      await tx.delete(athleteInviteFansTable).where(inArray(athleteInviteFansTable.inviteId, inviteIds));
      await tx.delete(athleteInviteFanDeliveriesTable)
        .where(inArray(athleteInviteFanDeliveriesTable.inviteId, inviteIds));
    }
    await tx.delete(athleteInvitePhotoUploadClaimsTable)
      .where(eq(athleteInvitePhotoUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(athleteInviteFanRateLimitsTable)
      .where(eq(athleteInviteFanRateLimitsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(guestUsageEventsTable).where(eq(guestUsageEventsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(supporterPhotosTable).where(eq(supporterPhotosTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(supporterPhotoUploadClaimsTable).where(eq(supporterPhotoUploadClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(plannerOwnerEventAlertClaimsTable)
      .where(eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(supporterActiveGamesTable)
      .where(eq(supporterActiveGamesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(gameOnReminderSyncTable)
      .where(eq(gameOnReminderSyncTable.key, `owner:${account.ownerClerkUserId}`));
    await tx.delete(checklistSharesTable)
      .where(eq(checklistSharesTable.ownerClerkUserId, account.ownerClerkUserId));
    await tx.delete(meetingWorkspacesTable)
      .where(eq(meetingWorkspacesTable.ownerClerkUserId, account.ownerClerkUserId));
  });

  try {
    await dependencies.deleteClerkUser(account.ownerClerkUserId);
  } catch (error) {
    if (!isClerkNotFound(error)) throw error;
  }

  await db.transaction(async (tx) => {
    if (account.adminDeletionActionId) {
      await tx.update(adminActionAuditTable).set({
        status: "completed",
        failureCode: null,
        completedAt: new Date(),
      }).where(eq(adminActionAuditTable.id, account.adminDeletionActionId));
    }
    await tx.delete(accountAccessTable).where(eq(accountAccessTable.id, account.id));
  });
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
      await db.transaction(async (tx) => {
        if (account.adminDeletionActionId) {
          await tx.update(adminActionAuditTable).set({
            status: "failed",
            failureCode: "account_cleanup_failed",
            completedAt: null,
          }).where(eq(adminActionAuditTable.id, account.adminDeletionActionId));
        }
        await tx.update(accountAccessTable)
          .set({
            purgeStartedAt: null,
            purgeError: errorMessage(error),
            updatedAt: new Date(),
          })
          .where(eq(accountAccessTable.id, account.id));
      });
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