import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import {
  accountAccessTable,
  cloudProjectsTable,
  db,
  guestUsageEventsTable,
  projectMediaTable,
} from "@workspace/db";
import {
  cancelAccount,
  getAccountLifecycleSnapshot,
  reactivateAccount,
} from "./lib/accountLifecycle";
import { runExpiredAccountPurge } from "./jobs/purgeCancelledAccounts";

async function deleteTestAccount(ownerClerkUserId: string) {
  await db.delete(projectMediaTable).where(eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(guestUsageEventsTable).where(eq(guestUsageEventsTable.ownerClerkUserId, ownerClerkUserId));
  await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
}

test("lifecycle transitions cannot reset expired or purge-claimed accounts", async () => {
  const ownerClerkUserId = `lifecycle-test-${randomUUID()}`;
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId,
      role: "coach",
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
      role: "coach",
      accessMode: "full",
    });
    const fresh = await getAccountLifecycleSnapshot(ownerClerkUserId);
    assert.equal(fresh.status, "active");
  } finally {
    await deleteTestAccount(ownerClerkUserId);
  }
});