import assert from "node:assert/strict";
import { and, eq, inArray, or } from "drizzle-orm";
import test from "node:test";
import {
  accountAccessTable,
  accountEntitlementEventsTable,
  adminActionAuditTable,
  adminUsersTable,
  athleteInviteEventDeliveryClaimsTable,
  athleteInviteEventLinksTable,
  athleteInviteFanDeliveriesTable,
  athleteInviteFanRateLimitsTable,
  athleteInviteFansTable,
  athleteInviteHypesTable,
  athleteInvitePhotoUploadClaimsTable,
  athleteInvitesTable,
  checklistSharesTable,
  cloudProjectsTable,
  db,
  gameOnReminderSyncTable,
  gameOnScheduledRemindersTable,
  guestUsageEventsTable,
  hypeCardShareRepliesTable,
  hypeCardShareUploadClaimsTable,
  hypeCardSharesTable,
  meetingWorkspacesTable,
  plannerCardNotificationDeliveriesTable,
  plannerNotificationDeliveriesTable,
  plannerNotificationPreferencesTable,
  plannerOwnerEventAlertClaimsTable,
  projectMediaTable,
  projectMediaUploadClaimsTable,
  scheduleSharesTable,
  statTrackerSharesTable,
  supporterActiveGamesTable,
  supporterPhotoUploadClaimsTable,
  supporterPhotosTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { runExpiredAccountPurge } from "./purgeCancelledAccounts";

const timestamp = new Date(Date.now() + 60_000);

async function cleanupFixture(ownerId: string, actorId: string, fixtureKey: string) {
  const [ownedInvites, ownedScheduleShares, ownedHypeShares] = await Promise.all([
    db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.ownerClerkUserId, ownerId)),
    db.select({ id: scheduleSharesTable.id }).from(scheduleSharesTable)
      .where(eq(scheduleSharesTable.ownerClerkUserId, ownerId)),
    db.select({ id: hypeCardSharesTable.id }).from(hypeCardSharesTable)
      .where(eq(hypeCardSharesTable.ownerClerkUserId, ownerId)),
  ]);
  const inviteIds = ownedInvites.map(({ id }) => id);
  const scheduleShareIds = ownedScheduleShares.map(({ id }) => id);
  const hypeShareIds = ownedHypeShares.map(({ id }) => id);
  const deliveryConditions = [
    ...(inviteIds.length ? [inArray(athleteInviteEventDeliveryClaimsTable.inviteId, inviteIds)] : []),
    ...(scheduleShareIds.length ? [inArray(athleteInviteEventDeliveryClaimsTable.shareId, scheduleShareIds)] : []),
  ];
  await db.transaction(async (tx) => {
    if (deliveryConditions.length) {
      await tx.delete(athleteInviteEventDeliveryClaimsTable)
        .where(deliveryConditions.length === 1 ? deliveryConditions[0] : or(...deliveryConditions));
    }
    if (inviteIds.length) {
      await tx.delete(athleteInviteEventLinksTable).where(inArray(athleteInviteEventLinksTable.inviteId, inviteIds));
      await tx.delete(athleteInviteFanDeliveriesTable)
        .where(inArray(athleteInviteFanDeliveriesTable.inviteId, inviteIds));
      await tx.delete(athleteInviteFansTable).where(inArray(athleteInviteFansTable.inviteId, inviteIds));
      await tx.delete(athleteInviteHypesTable).where(inArray(athleteInviteHypesTable.inviteId, inviteIds));
      await tx.delete(athleteInvitePhotoUploadClaimsTable)
        .where(inArray(athleteInvitePhotoUploadClaimsTable.inviteId, inviteIds));
    }
    if (scheduleShareIds.length) {
      await tx.delete(plannerCardNotificationDeliveriesTable)
        .where(inArray(plannerCardNotificationDeliveriesTable.shareId, scheduleShareIds));
      await tx.delete(gameOnScheduledRemindersTable)
        .where(inArray(gameOnScheduledRemindersTable.shareId, scheduleShareIds));
    }
    if (hypeShareIds.length) {
      await tx.delete(hypeCardShareRepliesTable)
        .where(inArray(hypeCardShareRepliesTable.shareId, hypeShareIds));
    }
    await tx.delete(accountEntitlementEventsTable)
      .where(eq(accountEntitlementEventsTable.ownerClerkUserId, ownerId));
    await tx.delete(projectMediaTable).where(eq(projectMediaTable.ownerClerkUserId, ownerId));
    await tx.delete(projectMediaUploadClaimsTable)
      .where(eq(projectMediaUploadClaimsTable.ownerClerkUserId, ownerId));
    await tx.delete(hypeCardShareUploadClaimsTable)
      .where(eq(hypeCardShareUploadClaimsTable.ownerClerkUserId, ownerId));
    await tx.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await tx.delete(scheduleSharesTable).where(eq(scheduleSharesTable.ownerClerkUserId, ownerId));
    await tx.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.ownerClerkUserId, ownerId));
    await tx.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, ownerId));
    await tx.delete(athleteInvitePhotoUploadClaimsTable)
      .where(eq(athleteInvitePhotoUploadClaimsTable.ownerClerkUserId, ownerId));
    await tx.delete(athleteInviteFanRateLimitsTable)
      .where(eq(athleteInviteFanRateLimitsTable.ownerClerkUserId, ownerId));
    await tx.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerId));
    await tx.delete(guestUsageEventsTable).where(eq(guestUsageEventsTable.ownerClerkUserId, ownerId));
    await tx.delete(supporterPhotosTable).where(eq(supporterPhotosTable.ownerClerkUserId, ownerId));
    await tx.delete(supporterPhotoUploadClaimsTable)
      .where(eq(supporterPhotoUploadClaimsTable.ownerClerkUserId, ownerId));
    await tx.delete(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerId));
    await tx.delete(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerId));
    await tx.delete(plannerOwnerEventAlertClaimsTable)
      .where(eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, ownerId));
    await tx.delete(supporterActiveGamesTable)
      .where(eq(supporterActiveGamesTable.ownerClerkUserId, ownerId));
    await tx.delete(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.ownerClerkUserId, ownerId));
    await tx.delete(gameOnReminderSyncTable).where(eq(gameOnReminderSyncTable.key, `owner:${ownerId}`));
    await tx.delete(checklistSharesTable).where(eq(checklistSharesTable.ownerClerkUserId, ownerId));
    await tx.delete(meetingWorkspacesTable).where(eq(meetingWorkspacesTable.ownerClerkUserId, ownerId));
    await tx.delete(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerId));
    await tx.delete(plannerOwnerEventAlertClaimsTable)
      .where(eq(plannerOwnerEventAlertClaimsTable.ownerClerkUserId, ownerId));
    await tx.delete(plannerNotificationDeliveriesTable)
      .where(inArray(
        plannerNotificationDeliveriesTable.projectId,
        db.select({ id: cloudProjectsTable.id }).from(cloudProjectsTable)
          .where(eq(cloudProjectsTable.ownerClerkUserId, ownerId)),
      ));
    await tx.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await tx.delete(adminActionAuditTable).where(or(
      eq(adminActionAuditTable.actorClerkUserId, actorId),
      eq(adminActionAuditTable.targetClerkUserId, ownerId),
    ));
    await tx.delete(adminUsersTable).where(eq(adminUsersTable.clerkUserId, actorId));
    await tx.delete(adminUsersTable).where(eq(adminUsersTable.clerkUserId, ownerId));
    await tx.delete(adminActionAuditTable).where(eq(adminActionAuditTable.reason, fixtureKey));
  });
}

test("account purge removes owned records and private objects, retains audit history, and retries cleanup failures", async () => {
  const ownerId = `purge-member-${crypto.randomUUID()}`;
  const actorId = `purge-admin-${crypto.randomUUID()}`;
  const fixtureKey = `purge-fixture-${crypto.randomUUID()}`;
  const objectPaths = [
    "fixture/project-media",
    "fixture/project-media-claim",
    "fixture/hype-video",
    "fixture/hype-poster",
    "fixture/hype-claim",
    "fixture/supporter-photo",
    "fixture/supporter-photo-claim",
    "fixture/invite-photo",
    "fixture/invite-photo-claim",
  ];

  await db.insert(adminActionAuditTable).values({
    actorClerkUserId: actorId,
    targetClerkUserId: ownerId,
    action: "profile_updated",
    status: "completed",
    reason: fixtureKey,
    completedAt: new Date(),
  });
  const [deletionAudit] = await db.insert(adminActionAuditTable).values({
    actorClerkUserId: actorId,
    targetClerkUserId: ownerId,
    action: "account_deleted",
    status: "pending",
    reason: fixtureKey,
  }).returning();
  await db.insert(accountAccessTable).values({
    ownerClerkUserId: ownerId,
    role: "fan",
    accessMode: "full",
    lifecycleStatus: "deletion_pending",
    adminDeletionActionId: deletionAudit.id,
  });

  try {
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Purge fixture",
      project: {},
    }).returning();
    const [scheduleShare] = await db.insert(scheduleSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Purge fixture schedule",
      teamSeason: "Test season",
      events: [],
    }).returning();
    const [invite] = await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: `invite-${crypto.randomUUID()}`,
      athleteName: "Fixture Athlete",
      teamName: "Fixture Team",
      seasonName: "Fixture Season",
      seasonEndsAt: timestamp,
      sport: "baseball",
      photoObjectPath: objectPaths[7],
    }).returning();
    const [hypeShare] = await db.insert(hypeCardSharesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: `hype-${crypto.randomUUID()}`,
      slug: `purge-${crypto.randomUUID()}`,
      title: "Purge fixture card",
      manifest: {},
      expiresAt: timestamp,
      videoObjectPath: objectPaths[2],
      posterObjectPath: objectPaths[3],
    }).returning();
    const [reminder] = await db.insert(gameOnScheduledRemindersTable).values({
      shareId: scheduleShare.id,
      ownerClerkUserId: ownerId,
      eventId: "fixture-event",
      eventDate: "2026-10-01",
      eventTime: "16:00",
      eventType: "game",
      timezone: "America/New_York",
      reminderType: "one_hour_before",
      dueAt: timestamp,
      expiresAt: timestamp,
      nextAttemptAt: timestamp,
    }).returning();
    assert.ok(reminder);

    await db.insert(accountEntitlementEventsTable).values({
      providerEventId: `purge-entitlement-${crypto.randomUUID()}`,
      ownerClerkUserId: ownerId,
      entitlementExpiresAt: timestamp,
    });
    await db.insert(guestUsageEventsTable).values({
      ownerClerkUserId: ownerId,
      category: "hype_card",
      usageKey: fixtureKey,
    });
    await db.insert(projectMediaTable).values({
      ownerClerkUserId: ownerId,
      projectId: project.id,
      objectPath: objectPaths[0],
      name: "Fixture image",
      contentType: "image/png",
      mediaType: "image",
      size: 64,
    });
    await db.insert(projectMediaUploadClaimsTable).values({
      ownerClerkUserId: ownerId,
      projectId: project.id,
      name: "Fixture upload",
      contentType: "image/png",
      mediaRole: "photo",
      size: 64,
      objectPath: objectPaths[1],
      expiresAt: timestamp,
    });
    await db.insert(projectMediaUploadClaimsTable).values({
      ownerClerkUserId: ownerId,
      projectId: project.id,
      name: "Duplicate path claim",
      contentType: "image/png",
      mediaRole: "photo",
      size: 64,
      objectPath: objectPaths[0],
      expiresAt: timestamp,
    });
    await db.insert(hypeCardShareUploadClaimsTable).values({
      ownerClerkUserId: ownerId,
      mediaKind: "video",
      objectPath: objectPaths[4],
      expiresAt: timestamp,
    });
    await db.insert(supporterPhotosTable).values({
      ownerClerkUserId: ownerId,
      objectPath: objectPaths[5],
      contentType: "image/jpeg",
      size: 64,
    });
    await db.insert(supporterPhotoUploadClaimsTable).values({
      ownerClerkUserId: ownerId,
      objectPath: objectPaths[6],
      expiresAt: timestamp,
    });
    await db.insert(athleteInvitePhotoUploadClaimsTable).values({
      inviteId: invite.id,
      ownerClerkUserId: ownerId,
      objectPath: objectPaths[8],
      contentType: "image/jpeg",
      size: 64,
      expiresAt: timestamp,
    });
    await db.insert(athleteInviteFansTable).values({
      inviteId: invite.id,
      endpoint: `https://push.example.test/${crypto.randomUUID()}`,
      p256dh: "fixture-key",
      auth: "fixture-auth",
      followTokenHash: `follow-${crypto.randomUUID()}`,
      liveAlerts: true,
      eventAlerts: true,
    });
    await db.insert(athleteInviteFanDeliveriesTable).values({
      inviteId: invite.id,
      eventKey: fixtureKey,
      notificationType: "live",
    });
    await db.insert(athleteInviteFanRateLimitsTable).values({
      ownerClerkUserId: ownerId,
      rateKey: fixtureKey,
      windowStartedAt: new Date(),
    });
    await db.insert(athleteInviteHypesTable).values({
      inviteId: invite.id,
      reaction: "clap",
      rateLimitKey: fixtureKey,
    });
    await db.insert(athleteInviteEventLinksTable).values({
      inviteId: invite.id,
      shareId: scheduleShare.id,
    });
    await db.insert(athleteInviteEventDeliveryClaimsTable).values({
      inviteId: invite.id,
      shareId: scheduleShare.id,
      eventId: "fixture-event",
      deviceKeyHash: `device-${crypto.randomUUID()}`,
    });
    await db.insert(checklistSharesTable).values({
      ownerClerkUserId: ownerId,
      title: "Purge fixture checklist",
      items: [],
    });
    await db.insert(meetingWorkspacesTable).values({
      ownerClerkUserId: ownerId,
      ownerMeetingId: fixtureKey,
      publicToken: `meeting-${crypto.randomUUID()}`,
      workspace: {},
    });
    await db.insert(statTrackerSharesTable).values({
      ownerClerkUserId: ownerId,
      gameId: fixtureKey,
      athleteName: "Fixture Athlete",
      teamName: "Fixture Team",
      game: {},
      expiresAt: timestamp,
    });
    await db.insert(hypeCardShareRepliesTable).values({
      shareId: hypeShare.id,
      reaction: "clap",
      rateLimitKey: fixtureKey,
    });
    await db.insert(plannerNotificationPreferencesTable).values({
      ownerClerkUserId: ownerId,
    });
    await db.insert(plannerOwnerEventAlertClaimsTable).values({
      ownerClerkUserId: ownerId,
      eventId: "fixture-event",
      eventDate: "2026-10-01",
    });
    await db.insert(supporterActiveGamesTable).values({
      ownerClerkUserId: ownerId,
      gameId: fixtureKey,
    });
    await db.insert(webPushSubscriptionsTable).values({
      ownerClerkUserId: ownerId,
      endpoint: `https://push.example.test/sub-${crypto.randomUUID()}`,
      p256dh: "fixture-p256dh",
      auth: "fixture-auth",
    });
    await db.insert(gameOnReminderSyncTable).values({
      key: `owner:${ownerId}`,
    });
    await db.insert(plannerNotificationDeliveriesTable).values({
      projectId: project.id,
      eventId: "fixture-event",
      notificationType: "day_of",
      eventDate: "2026-10-01",
    });
    await db.insert(plannerCardNotificationDeliveriesTable).values({
      shareId: scheduleShare.id,
      eventId: "fixture-event",
      notificationType: "day_of",
      eventDate: "2026-10-01",
    });

    const calls: string[] = [];
    let failObjectStoreOnce = true;
    let failClerkOnce = true;
    const dependencies = {
      deleteObject: async (path: string) => {
        calls.push(path);
        if (failObjectStoreOnce) {
          failObjectStoreOnce = false;
          throw new Error("fixture object storage outage");
        }
      },
      deleteClerkUser: async () => {
        if (failClerkOnce) {
          failClerkOnce = false;
          throw new Error("fixture Clerk outage");
        }
      },
    };

    await runExpiredAccountPurge({ ownerClerkUserId: ownerId, dependencies });
    let [action] = await db.select().from(adminActionAuditTable)
      .where(eq(adminActionAuditTable.id, deletionAudit.id))
      .limit(1);
    assert.equal(action?.status, "failed");
    assert.equal(calls.length, 1);
    assert.equal((await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerId))).length, 1);

    await runExpiredAccountPurge({ ownerClerkUserId: ownerId, dependencies });
    [action] = await db.select().from(adminActionAuditTable)
      .where(eq(adminActionAuditTable.id, deletionAudit.id))
      .limit(1);
    assert.equal(action?.status, "failed");
    assert.equal((await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerId))).length, 1);
    assert.deepEqual([...new Set(calls)].sort(), [...objectPaths].sort());

    const [retainedAudit] = await db.select().from(adminActionAuditTable)
      .where(and(
        eq(adminActionAuditTable.actorClerkUserId, actorId),
        eq(adminActionAuditTable.targetClerkUserId, ownerId),
        eq(adminActionAuditTable.action, "profile_updated"),
      ))
      .limit(1);
    assert.ok(retainedAudit);
    assert.equal((await db.select().from(athleteInviteEventDeliveryClaimsTable)
      .where(or(
        eq(athleteInviteEventDeliveryClaimsTable.inviteId, invite.id),
        eq(athleteInviteEventDeliveryClaimsTable.shareId, scheduleShare.id),
      ))).length, 0);
    assert.equal((await db.select().from(plannerNotificationDeliveriesTable)
      .where(eq(plannerNotificationDeliveriesTable.projectId, project.id))).length, 0);
    assert.equal((await db.select().from(plannerCardNotificationDeliveriesTable)
      .where(eq(plannerCardNotificationDeliveriesTable.shareId, scheduleShare.id))).length, 0);
    assert.equal((await db.select().from(athleteInviteFanDeliveriesTable)
      .where(eq(athleteInviteFanDeliveriesTable.inviteId, invite.id))).length, 0);
    assert.equal((await db.select().from(gameOnScheduledRemindersTable)
      .where(eq(gameOnScheduledRemindersTable.id, reminder.id))).length, 0);
    assert.equal((await db.select().from(hypeCardShareRepliesTable)
      .where(eq(hypeCardShareRepliesTable.shareId, hypeShare.id))).length, 0);

    await runExpiredAccountPurge({ ownerClerkUserId: ownerId, dependencies });
    [action] = await db.select().from(adminActionAuditTable)
      .where(eq(adminActionAuditTable.id, deletionAudit.id))
      .limit(1);
    assert.equal(action?.status, "completed");
    assert.ok(action?.completedAt);
    assert.equal((await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerId))).length, 0);
    assert.equal((await db.select().from(adminActionAuditTable)
      .where(eq(adminActionAuditTable.reason, fixtureKey))).length, 2);
  } finally {
    await cleanupFixture(ownerId, actorId, fixtureKey);
  }
});

test("account purge refuses to claim an administrator account", async () => {
  const ownerId = `purge-admin-member-${crypto.randomUUID()}`;
  const [access] = await db.insert(accountAccessTable).values({
    ownerClerkUserId: ownerId,
    role: "fan",
    accessMode: "full",
    lifecycleStatus: "cancelled",
    cancelledAt: new Date(Date.now() - 2000),
    deletionEligibleAt: new Date(Date.now() - 1000),
  }).returning();
  await db.insert(adminUsersTable).values({ clerkUserId: ownerId });
  try {
    let deleteCalls = 0;
    await runExpiredAccountPurge({
      ownerClerkUserId: ownerId,
      dependencies: {
        deleteObject: async () => {
          deleteCalls += 1;
        },
        deleteClerkUser: async () => {
          deleteCalls += 1;
        },
      },
    });
    const [remaining] = await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.id, access.id))
      .limit(1);
    assert.equal(remaining?.lifecycleStatus, "cancelled");
    assert.equal(deleteCalls, 0);
  } finally {
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(adminUsersTable).where(eq(adminUsersTable.clerkUserId, ownerId));
  }
});