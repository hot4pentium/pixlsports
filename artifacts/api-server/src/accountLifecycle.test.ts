import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count, eq, inArray } from "drizzle-orm";
import {
  accountAccessTable,
  accountEntitlementEventsTable,
  athleteInviteFanDeliveriesTable,
  athleteInviteFanRateLimitsTable,
  athleteInviteFansTable,
  athleteInvitePhotoUploadClaimsTable,
  athleteInvitesTable,
  cloudProjectsTable,
  db,
  guestUsageEventsTable,
  projectMediaTable,
  projectMediaUploadClaimsTable,
} from "@workspace/db";
import {
  cancelAccount,
  getAccountLifecycleSnapshot,
  reactivateAccount,
  reactivateAccountFromEntitlement,
  hasActivePaidEntitlement,
  isAccountActive,
  pauseAccount,
  resumeAccount,
} from "./lib/accountLifecycle";
import { runExpiredAccountPurge } from "./jobs/purgeCancelledAccounts";
import { getAccountAccessSnapshot } from "./routes/accountAccess";

async function deleteTestAccount(ownerClerkUserId: string) {
  const invites = await db.select({ id: athleteInvitesTable.id }).from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId));
  if (invites.length) {
    const inviteIds = invites.map((invite) => invite.id);
    await db.delete(athleteInviteFansTable).where(inArray(athleteInviteFansTable.inviteId, inviteIds));
    await db.delete(athleteInviteFanDeliveriesTable)
      .where(inArray(athleteInviteFanDeliveriesTable.inviteId, inviteIds));
  }
  await db.delete(athleteInvitePhotoUploadClaimsTable)
    .where(eq(athleteInvitePhotoUploadClaimsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(athleteInviteFanRateLimitsTable)
    .where(eq(athleteInviteFanRateLimitsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(projectMediaTable).where(eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(projectMediaUploadClaimsTable).where(eq(projectMediaUploadClaimsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(guestUsageEventsTable).where(eq(guestUsageEventsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(accountEntitlementEventsTable).where(eq(accountEntitlementEventsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
}

test("paid eligibility requires active lifecycle and an unexpired entitlement", async () => {
  const ownerClerkUserId = `paid-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({ ownerClerkUserId, role: "fan", accessMode: "full" });
    assert.equal(await hasActivePaidEntitlement(ownerClerkUserId), false);
    await db.insert(accountEntitlementEventsTable).values({
      providerEventId: randomUUID(),
      ownerClerkUserId,
      entitlementExpiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal(await hasActivePaidEntitlement(ownerClerkUserId), true);
    await db.update(accountAccessTable).set({ lifecycleStatus: "cancelled" })
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    assert.equal(await hasActivePaidEntitlement(ownerClerkUserId), false);
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("pause locks access without starting deletion and resumes only the paused account", async () => {
  const ownerClerkUserId = `pause-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({ ownerClerkUserId, role: "fan", accessMode: "full" });
    const paused = await pauseAccount(ownerClerkUserId);
    assert.equal(paused?.status, "paused");
    assert.equal(paused?.deletionEligibleAt, null);
    assert.equal(paused?.cancelledAt, null);
    assert.ok(paused?.pauseEndsAt);
    assert.equal(await isAccountActive(ownerClerkUserId), false);
    assert.ok(Math.abs(paused!.pauseEndsAt!.getTime() - Date.now() - 90 * 86_400_000) < 5_000);
    assert.equal(await hasActivePaidEntitlement(ownerClerkUserId), false);
    assert.equal((await cancelAccount(ownerClerkUserId))?.status, "paused");
    assert.equal((await pauseAccount(ownerClerkUserId))?.pauseEndsAt?.getTime(), paused?.pauseEndsAt?.getTime());
    assert.equal((await resumeAccount(ownerClerkUserId))?.status, "active");
    assert.equal(await isAccountActive(ownerClerkUserId), true);
    assert.equal(await resumeAccount(ownerClerkUserId), null);
    assert.equal((await getAccountLifecycleSnapshot(ownerClerkUserId)).pauseEndsAt, null);
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("expired pause automatically restores access without entering the purge lifecycle", async () => {
  const ownerClerkUserId = `pause-expired-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId, role: "fan", accessMode: "full",
      lifecycleStatus: "paused", pauseEndsAt: new Date(Date.now() - 1_000),
    });
    const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
    assert.equal(lifecycle.status, "active");
    assert.equal(await isAccountActive(ownerClerkUserId), true);
    assert.equal(lifecycle.pauseEndsAt, null);
    assert.equal(lifecycle.deletionEligibleAt, null);
    assert.equal((await cancelAccount(ownerClerkUserId))?.status, "cancelled");
    assert.equal(await pauseAccount(ownerClerkUserId), null);
    assert.equal(await resumeAccount(ownerClerkUserId), null);
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("simultaneous pause and cancellation never leave conflicting deadlines", async () => {
  const ownerClerkUserId = `pause-race-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({ ownerClerkUserId, role: "fan", accessMode: "full" });
    await Promise.all([pauseAccount(ownerClerkUserId), cancelAccount(ownerClerkUserId)]);
    const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
    assert.ok(lifecycle.status === "paused" || lifecycle.status === "cancelled");
    if (lifecycle.status === "paused") {
      assert.ok(lifecycle.pauseEndsAt);
      assert.equal(lifecycle.deletionEligibleAt, null);
    } else {
      assert.equal(lifecycle.pauseEndsAt, null);
      assert.ok(lifecycle.deletionEligibleAt);
    }
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("named tiers are derived from unexpired signed entitlements, with legacy events mapped to Plus", async () => {
  const ownerClerkUserId = `plan-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({ ownerClerkUserId, role: "fan", accessMode: "full" });
    assert.equal((await getAccountLifecycleSnapshot(ownerClerkUserId)).planTier, "free");
    await db.insert(accountEntitlementEventsTable).values({
      providerEventId: randomUUID(), ownerClerkUserId,
      entitlementExpiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal((await getAccountLifecycleSnapshot(ownerClerkUserId)).planTier, "plus");
    await db.insert(accountEntitlementEventsTable).values({
      providerEventId: randomUUID(), ownerClerkUserId, planTier: "pro",
      entitlementExpiresAt: new Date(Date.now() + 30_000),
    });
    assert.equal((await getAccountLifecycleSnapshot(ownerClerkUserId)).planTier, "pro");
    await db.update(accountEntitlementEventsTable)
      .set({ entitlementExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(accountEntitlementEventsTable.ownerClerkUserId, ownerClerkUserId));
    assert.equal((await getAccountLifecycleSnapshot(ownerClerkUserId)).planTier, "free");
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("access snapshots lazily normalize stale roles", async () => {
  const ownerClerkUserId = `stale-role-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "legacy",
      accessMode: "full",
    });

    const snapshot = await getAccountAccessSnapshot(ownerClerkUserId);
    assert.equal(snapshot.role, "fan");

    const [access] = await db
      .select({ role: accountAccessTable.role })
      .from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    assert.equal(access?.role, "fan");
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("lifecycle transitions cannot reset expired or purge-claimed accounts", async () => {
  const ownerClerkUserId = `lifecycle-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "fan",
      accessMode: "guest",
    });

    const cancelled = await cancelAccount(ownerClerkUserId);
    assert.equal(cancelled?.status, "cancelled");
    const firstDeadline = cancelled?.deletionEligibleAt?.getTime();
    assert.ok(firstDeadline);

    const repeatedCancellation = await cancelAccount(ownerClerkUserId);
    assert.equal(repeatedCancellation?.deletionEligibleAt?.getTime(), firstDeadline);

    await db
      .update(accountAccessTable)
      .set({ deletionEligibleAt: new Date(Date.now() - 1_000) })
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));

    const expired = await getAccountLifecycleSnapshot(ownerClerkUserId, { touchCancelledActivity: true });
    assert.equal(expired.expired, true);
    assert.equal(await reactivateAccount(ownerClerkUserId), null);
    const expiredCancellation = await cancelAccount(ownerClerkUserId);
    assert.equal(expiredCancellation?.expired, true);

    await db
      .update(accountAccessTable)
      .set({ lifecycleStatus: "deletion_pending", purgeStartedAt: new Date() })
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));

    assert.equal(await reactivateAccount(ownerClerkUserId), null);
    const claimedCancellation = await cancelAccount(ownerClerkUserId);
    assert.equal(claimedCancellation?.status, "deletion_pending");
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("purge retries each destructive phase and allows a fresh account row", async () => {
  const ownerClerkUserId = `purge-test-${randomUUID()}`;
  const objectPath = `tests/${randomUUID()}.png`;
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "fan",
      accessMode: "full",
      lifecycleStatus: "cancelled",
      cancelledAt: new Date(Date.now() - 91 * 86_400_000),
      lastActivityAt: new Date(Date.now() - 91 * 86_400_000),
      deletionEligibleAt: new Date(Date.now() - 1_000),
    });
    const [project] = await db
      .insert(cloudProjectsTable)
      .values({ ownerClerkUserId, name: "Purge retry test", project: { tool: "hype" } })
      .returning();
    await db.insert(projectMediaTable).values({
      ownerClerkUserId,
      projectId: project.id,
      objectPath,
      name: "test.png",
      contentType: "image/png",
      mediaType: "image",
      size: 1,
    });
    await db.insert(guestUsageEventsTable).values({
      ownerClerkUserId,
      category: "hype_card",
      usageKey: "purge-retry",
    });

    await runExpiredAccountPurge({
      ownerClerkUserId,
      dependencies: {
        deleteObject: async () => {
          throw new Error("simulated object storage outage");
        },
        deleteClerkUser: async () => undefined,
      },
    });
    let [accountCount] = await db
      .select({ value: count() })
      .from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    assert.equal(Number(accountCount.value), 1);

    await runExpiredAccountPurge({
      ownerClerkUserId,
      dependencies: {
        deleteObject: async () => undefined,
        deleteClerkUser: async () => {
          throw Object.assign(new Error("simulated Clerk outage"), { status: 503 });
        },
      },
    });
    [accountCount] = await db
      .select({ value: count() })
      .from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    assert.equal(Number(accountCount.value), 1);
    const [projectCount] = await db
      .select({ value: count() })
      .from(cloudProjectsTable)
      .where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId));
    assert.equal(Number(projectCount.value), 0);

    await runExpiredAccountPurge({
      ownerClerkUserId,
      dependencies: {
        deleteObject: async () => undefined,
        deleteClerkUser: async () => undefined,
      },
    });
    [accountCount] = await db
      .select({ value: count() })
      .from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    assert.equal(Number(accountCount.value), 0);

    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "fan",
      accessMode: "full",
    });
    const fresh = await getAccountLifecycleSnapshot(ownerClerkUserId);
    assert.equal(fresh.status, "active");
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("account purge removes Athlete Hype Page photos, claims, follows, deliveries, and rate rows", async () => {
  const ownerClerkUserId = `purge-athlete-invite-${randomUUID()}`;
  const photoPath = `/objects/athlete-invite-photos/${randomUUID()}.webp`;
  const claimPath = `/objects/uploads/${randomUUID()}`;
  const deletedObjects = new Set<string>();
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "fan",
      accessMode: "full",
      lifecycleStatus: "cancelled",
      cancelledAt: new Date(Date.now() - 91 * 86_400_000),
      lastActivityAt: new Date(Date.now() - 91 * 86_400_000),
      deletionEligibleAt: new Date(Date.now() - 1_000),
    });
    const [invite] = await db.insert(athleteInvitesTable).values({
      ownerClerkUserId,
      publicToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
      athleteName: "Purge Athlete",
      teamName: "Team",
      seasonName: "Season",
      seasonEndsAt: new Date(Date.now() + 86_400_000),
      sport: "basketball",
      timezone: "UTC",
      showHypeCard: true,
      showStats: true,
      showSchedule: true,
      paused: false,
      photoObjectPath: photoPath,
    }).returning();
    await db.insert(athleteInvitePhotoUploadClaimsTable).values({
      inviteId: invite!.id,
      ownerClerkUserId,
      objectPath: claimPath,
      contentType: "image/jpeg",
      size: 123,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(athleteInviteFansTable).values({
      inviteId: invite!.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`,
      p256dh: "encrypted-key",
      auth: "auth-secret",
      followTokenHash: randomUUID().replaceAll("-", ""),
      liveAlerts: true,
      eventAlerts: true,
    });
    await db.insert(athleteInviteFanDeliveriesTable).values({
      inviteId: invite!.id,
      eventKey: "event",
      notificationType: "event_alert",
    });
    await db.insert(athleteInviteFanRateLimitsTable).values({
      rateKey: randomUUID().replaceAll("-", ""),
      ownerClerkUserId,
      windowStartedAt: new Date(),
      attempts: 1,
    });

    await runExpiredAccountPurge({
      ownerClerkUserId,
      dependencies: {
        deleteObject: async (path) => { deletedObjects.add(path); },
        deleteClerkUser: async () => undefined,
      },
    });

    assert.deepEqual(deletedObjects, new Set([photoPath, claimPath]));
    assert.deepEqual(await db.select().from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId)), []);
    assert.deepEqual(await db.select().from(athleteInvitePhotoUploadClaimsTable)
      .where(eq(athleteInvitePhotoUploadClaimsTable.ownerClerkUserId, ownerClerkUserId)), []);
    assert.deepEqual(await db.select().from(athleteInviteFansTable)
      .where(eq(athleteInviteFansTable.inviteId, invite!.id)), []);
    assert.deepEqual(await db.select().from(athleteInviteFanDeliveriesTable)
      .where(eq(athleteInviteFanDeliveriesTable.inviteId, invite!.id)), []);
    assert.deepEqual(await db.select().from(athleteInviteFanRateLimitsTable)
      .where(eq(athleteInviteFanRateLimitsTable.ownerClerkUserId, ownerClerkUserId)), []);
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("a verified paid entitlement restores an eligible account once and replays safely", async () => {
  const ownerClerkUserId = `entitlement-test-${randomUUID()}`;
  const providerEventId = `paid-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "fan",
      accessMode: "full",
    });
    await cancelAccount(ownerClerkUserId);

    const entitlement = {
      providerEventId,
      ownerClerkUserId,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
    const first = await reactivateAccountFromEntitlement(entitlement);
    assert.equal(first.replayed, false);
    assert.equal(first.restored, true);
    assert.equal(first.lifecycle?.status, "active");

    const replay = await reactivateAccountFromEntitlement(entitlement);
    assert.equal(replay.replayed, true);
    assert.equal(replay.restored, false);
    assert.equal(replay.lifecycle?.status, "active");
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("an expired paid entitlement cannot restore a cancelled account", async () => {
  const ownerClerkUserId = `expired-entitlement-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "fan",
      accessMode: "full",
    });
    await cancelAccount(ownerClerkUserId);

    const result = await reactivateAccountFromEntitlement({
      providerEventId: `expired-${randomUUID()}`,
      ownerClerkUserId,
      expiresAt: new Date(Date.now() - 1_000),
    });
    assert.equal(result.replayed, false);
    assert.equal(result.restored, false);
    assert.equal(result.lifecycle?.status, "cancelled");
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});

test("a paid entitlement cannot create or restore a missing account", async () => {
  const ownerClerkUserId = `missing-entitlement-test-${randomUUID()}`;
  const result = await reactivateAccountFromEntitlement({
    providerEventId: `missing-${randomUUID()}`,
    ownerClerkUserId,
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });

  assert.equal(result.replayed, false);
  assert.equal(result.restored, false);
  assert.equal(result.lifecycle, null);
});