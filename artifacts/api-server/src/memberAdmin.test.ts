import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import test from "node:test";
import {
  accountAccessTable,
  adminActionAuditTable,
  adminUsersTable,
  db,
} from "@workspace/db";
import memberAdminRouter from "./routes/memberAdmin";
import { requireAuth } from "./middlewares/requireAuth";
import {
  bootstrapAdminForVerifiedUser,
  hasAdminAccess,
  isAdminUser,
  isLastAdmin,
} from "./lib/adminAccess";
import {
  AdminRequestError,
  requestAdminMemberDeletion,
  updateAdminMemberAdministrator,
  updateAdminMemberProfile,
  updateAdminMemberSuspension,
} from "./lib/memberAdmin";
import {
  cancelAccount,
  getAccountLifecycleSnapshot,
  isAccountActive,
  pauseAccount,
} from "./lib/accountLifecycle";

function testApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { warn: () => undefined, error: () => undefined };
    next();
  });
  app.use("/api", memberAdminRouter);
  app.get("/api/__test/private", requireAuth, (_req, res) => {
    res.status(200).json({ available: true });
  });
  return app;
}

async function withTestServer<T>(run: (baseUrl: string) => Promise<T>) {
  const server = createServer(testApp());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}/api`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function withNodeEnv<T>(value: string, run: () => Promise<T>) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

function fakeClerkUser(id: string, emailAddress: string) {
  return {
    id,
    createdAt: Date.now(),
    firstName: "Test",
    lastName: "Member",
    publicMetadata: {},
    unsafeMetadata: {
      displayName: "Before",
      teamName: "Old team",
      retainedCustomValue: "keep",
    },
    primaryEmailAddressId: "email_test",
    emailAddresses: [{
      id: "email_test",
      emailAddress,
      verification: { status: "verified" },
    }],
  };
}

async function cleanFixture(ids: string[]) {
  if (!ids.length) return;
  await db.delete(accountAccessTable)
    .where(inArray(accountAccessTable.ownerClerkUserId, ids));
  await db.delete(adminActionAuditTable)
    .where(or(
      inArray(adminActionAuditTable.actorClerkUserId, ids),
      inArray(adminActionAuditTable.targetClerkUserId, ids),
    ));
  await db.delete(adminUsersTable).where(inArray(adminUsersTable.clerkUserId, ids));
}

test("admin routes reject unauthenticated and non-admin requests, while administrators can read audit history", async () => {
  const administratorId = `admin-route-${crypto.randomUUID()}`;
  const nonAdministratorId = `member-route-${crypto.randomUUID()}`;
  await db.insert(adminUsersTable).values({ clerkUserId: administratorId });
  try {
    await withNodeEnv("production", () => withTestServer(async (baseUrl) => {
      const unauthenticated = await fetch(`${baseUrl}/admin/audit`);
      assert.equal(unauthenticated.status, 401);

      const denied = await fetch(`${baseUrl}/admin/members`, {
        headers: { "x-test-user": nonAdministratorId },
      });
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { error: "Administrator access is required." });
      const deniedFilteredAudit = await fetch(
        `${baseUrl}/admin/audit?memberClerkUserId=${encodeURIComponent(nonAdministratorId)}&status=failed`,
        { headers: { "x-test-user": nonAdministratorId } },
      );
      assert.equal(deniedFilteredAudit.status, 403);

      const allowed = await fetch(`${baseUrl}/admin/audit`, {
        headers: { "x-test-user": administratorId },
      });
      assert.equal(allowed.status, 200);
      const body = await allowed.json() as { items: unknown[]; totalCount: number };
      assert.ok(Array.isArray(body.items));
      assert.ok(body.totalCount >= 0);
    }));
  } finally {
    await cleanFixture([administratorId, nonAdministratorId]);
  }
});

test("administrators can filter audit history by member, action, status, dates, and page", async () => {
  const administratorId = `admin-audit-filter-${crypto.randomUUID()}`;
  const targetId = `member-audit-filter-${crypto.randomUUID()}`;
  const otherTargetId = `member-audit-other-${crypto.randomUUID()}`;
  const otherAdministratorId = `admin-audit-other-${crypto.randomUUID()}`;
  await db.insert(adminUsersTable).values({ clerkUserId: administratorId });
  await db.insert(adminActionAuditTable).values([
    {
      actorClerkUserId: administratorId,
      targetClerkUserId: targetId,
      action: "profile_updated",
      status: "completed",
      createdAt: new Date("2025-02-02T09:30:00.000Z"),
    },
    {
      actorClerkUserId: administratorId,
      targetClerkUserId: targetId,
      action: "account_suspended",
      status: "failed",
      createdAt: new Date("2025-02-02T23:59:59.000Z"),
    },
    {
      actorClerkUserId: administratorId,
      targetClerkUserId: targetId,
      action: "administrator_granted",
      status: "completed",
      createdAt: new Date("2025-02-03T00:00:00.000Z"),
    },
    {
      actorClerkUserId: otherAdministratorId,
      targetClerkUserId: otherTargetId,
      action: "profile_updated",
      status: "completed",
      createdAt: new Date("2025-02-02T12:00:00.000Z"),
    },
  ]);
  try {
    await withTestServer(async (baseUrl) => {
      const headers = { "x-test-user": administratorId };
      const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

      const dateRange = await fetch(`${baseUrl}/admin/audit?${query({
        memberClerkUserId: targetId,
        fromDate: "2025-02-02",
        toDate: "2025-02-02",
      })}`, { headers });
      assert.equal(dateRange.status, 200);
      const dateRangeBody = await dateRange.json() as {
        items: Array<{ action: string; targetClerkUserId: string }>;
        totalCount: number;
      };
      assert.equal(dateRangeBody.totalCount, 2);
      assert.deepEqual(dateRangeBody.items.map((item) => item.action), ["account_suspended", "profile_updated"]);
      assert.ok(dateRangeBody.items.every((item) => item.targetClerkUserId === targetId));

      const actionStatus = await fetch(`${baseUrl}/admin/audit?${query({
        memberClerkUserId: targetId,
        action: "account_suspended",
        status: "failed",
      })}`, { headers });
      assert.equal(actionStatus.status, 200);
      const actionStatusBody = await actionStatus.json() as {
        items: Array<{ action: string; status: string }>;
        totalCount: number;
      };
      assert.equal(actionStatusBody.totalCount, 1);
      assert.deepEqual(actionStatusBody.items.map(({ action, status }) => ({ action, status })), [
        { action: "account_suspended", status: "failed" },
      ]);

      const secondPage = await fetch(`${baseUrl}/admin/audit?${query({
        memberClerkUserId: targetId,
        limit: "2",
        offset: "2",
      })}`, { headers });
      assert.equal(secondPage.status, 200);
      const secondPageBody = await secondPage.json() as {
        items: Array<{ targetClerkUserId: string }>;
        totalCount: number;
        limit: number;
        offset: number;
      };
      assert.equal(secondPageBody.totalCount, 3);
      assert.equal(secondPageBody.limit, 2);
      assert.equal(secondPageBody.offset, 2);
      assert.equal(secondPageBody.items.length, 1);
      assert.equal(secondPageBody.items[0]?.targetClerkUserId, targetId);

      const invalidRange = await fetch(`${baseUrl}/admin/audit?${query({
        fromDate: "2025-02-03",
        toDate: "2025-02-02",
      })}`, { headers });
      assert.equal(invalidRange.status, 400);
      assert.deepEqual(await invalidRange.json(), {
        error: "The start date must be on or before the end date.",
      });

      const invalidCalendarDate = await fetch(`${baseUrl}/admin/audit?${query({
        fromDate: "2025-02-31",
      })}`, { headers });
      assert.equal(invalidCalendarDate.status, 400);
      assert.deepEqual(await invalidCalendarDate.json(), {
        error: "Dates must be valid YYYY-MM-DD calendar dates.",
      });
    });
  } finally {
    await cleanFixture([administratorId, targetId, otherTargetId, otherAdministratorId]);
  }
});

test("production bootstrap requires the exact verified address and does not enroll disabled or unverified identities", async () => {
  const adminId = `admin-bootstrap-${crypto.randomUUID()}`;
  const disabledId = `admin-disabled-${crypto.randomUUID()}`;
  const unverifiedId = `admin-unverified-${crypto.randomUUID()}`;
  const address = `${crypto.randomUUID()}@example.test`;
  try {
    await withNodeEnv("production", async () => {
      const bootstrapped = await bootstrapAdminForVerifiedUser(
        adminId,
        { enabled: true, email: address.toUpperCase() },
        async () => ({
          emailAddresses: [{
            emailAddress: address,
            verification: { status: "verified" },
          }],
        }),
      );
      assert.equal(bootstrapped, true);
      assert.equal(await isAdminUser(adminId), true);
      assert.equal(await isLastAdmin(adminId), true);

      const disabled = await bootstrapAdminForVerifiedUser(
        disabledId,
        { enabled: false, email: address },
        async () => {
          throw new Error("Disabled bootstrap must not look up a Clerk identity");
        },
      );
      assert.equal(disabled, false);

      const unverified = await bootstrapAdminForVerifiedUser(
        unverifiedId,
        { enabled: true, email: address },
        async () => ({
          emailAddresses: [{
            emailAddress: address,
            verification: { status: "unverified" },
          }],
        }),
      );
      assert.equal(unverified, false);
      assert.equal(await isAdminUser(unverifiedId), false);

      const mismatched = await bootstrapAdminForVerifiedUser(
        unverifiedId,
        { enabled: true, email: `other-${address}` },
        async () => ({
          emailAddresses: [{
            emailAddress: address,
            verification: { status: "verified" },
          }],
        }),
      );
      assert.equal(mismatched, false);
    });
  } finally {
    await cleanFixture([adminId, disabledId, unverifiedId]);
  }
});

test("development rejects administrator authorization, bootstrap, and grant attempts", async () => {
  const administratorId = `admin-development-${crypto.randomUUID()}`;
  const targetId = `member-development-${crypto.randomUUID()}`;
  await withNodeEnv("development", async () => {
    assert.equal(await hasAdminAccess(administratorId), false);
    const bootstrapped = await bootstrapAdminForVerifiedUser(
      targetId,
      { enabled: true, email: `${crypto.randomUUID()}@example.test` },
      async () => {
        throw new Error("Development bootstrap must not look up a Clerk identity");
      },
    );
    assert.equal(bootstrapped, false);
    await assert.rejects(
      updateAdminMemberAdministrator(administratorId, targetId, true, null, {
        getUser: async () => {
          throw new Error("Development must reject admin changes before Clerk lookup");
        },
      }),
      (error: unknown) => error instanceof AdminRequestError && error.statusCode === 409,
    );
    await withTestServer(async (baseUrl) => {
      const session = await fetch(`${baseUrl}/admin/session`, {
        headers: { "x-test-user": administratorId },
      });
      assert.deepEqual(await session.json(), { isAdmin: false });
      const audit = await fetch(`${baseUrl}/admin/audit`, {
        headers: { "x-test-user": administratorId },
      });
      assert.equal(audit.status, 403);
    });
  });
});

test("production administrators can grant and revoke roles with durable audit entries", async () => {
  const actorId = `admin-role-actor-${crypto.randomUUID()}`;
  const secondAdminId = `admin-role-second-${crypto.randomUUID()}`;
  const targetId = `member-role-target-${crypto.randomUUID()}`;
  const address = `${crypto.randomUUID()}@example.test`;
  await db.insert(adminUsersTable).values([{ clerkUserId: actorId }, { clerkUserId: secondAdminId }]);
  try {
    await withNodeEnv("production", async () => {
      const grant = await updateAdminMemberAdministrator(actorId, targetId, true, "Backup coverage", {
        getUser: async (id) => id === targetId ? fakeClerkUser(targetId, address) as any : null,
      });
      assert.equal(grant?.action, "administrator_granted");
      assert.equal(grant?.status, "completed");
      assert.equal(await isAdminUser(targetId), true);

      const revoke = await updateAdminMemberAdministrator(actorId, targetId, false, "Role no longer needed");
      assert.ok(revoke);
      assert.equal(revoke.action, "administrator_revoked");
      assert.equal(await isAdminUser(targetId), false);

      const [grantedAudit, revokedAudit] = await Promise.all([
        db.select().from(adminActionAuditTable)
          .where(and(
            eq(adminActionAuditTable.actorClerkUserId, actorId),
            eq(adminActionAuditTable.targetClerkUserId, targetId),
            eq(adminActionAuditTable.action, "administrator_granted"),
          )).limit(1).then(([row]) => row),
        db.select().from(adminActionAuditTable)
          .where(and(
            eq(adminActionAuditTable.actorClerkUserId, actorId),
            eq(adminActionAuditTable.targetClerkUserId, targetId),
            eq(adminActionAuditTable.action, "administrator_revoked"),
          )).limit(1).then(([row]) => row),
      ]);
      assert.equal(grantedAudit?.status, "completed");
      assert.deepEqual(grantedAudit?.changedFields, ["isAdministrator"]);
      assert.equal(grantedAudit?.reason, "Backup coverage");
      assert.equal(revokedAudit?.status, "completed");
      assert.deepEqual(revokedAudit?.changedFields, ["isAdministrator"]);
      assert.equal(revokedAudit?.reason, "Role no longer needed");

      const concurrentRemovals = await Promise.allSettled([
        updateAdminMemberAdministrator(actorId, secondAdminId, false, "Concurrent administrator change"),
        updateAdminMemberAdministrator(secondAdminId, actorId, false, "Concurrent administrator change"),
      ]);
      assert.equal(concurrentRemovals.filter((result) => result.status === "fulfilled").length, 1);
      const actorStillAdmin = await isAdminUser(actorId);
      const secondAdminStillAdmin = await isAdminUser(secondAdminId);
      assert.notEqual(actorStillAdmin, secondAdminStillAdmin);
      const lastRemainingId = actorStillAdmin ? actorId : secondAdminId;
      assert.equal(await isLastAdmin(lastRemainingId), true);
      await assert.rejects(
        updateAdminMemberAdministrator(lastRemainingId, lastRemainingId, false),
        (error: unknown) => error instanceof AdminRequestError && error.statusCode === 409,
      );
      assert.equal(await isAdminUser(lastRemainingId), true);
      assert.equal(await updateAdminMemberAdministrator(actorId, targetId, true, null, {
        getUser: async () => null,
      }), null);
    });
  } finally {
    await cleanFixture([actorId, secondAdminId, targetId]);
  }
});

test("profile edits are audited and preserve unrelated Clerk metadata", async () => {
  const actorId = `admin-profile-${crypto.randomUUID()}`;
  const targetId = `member-profile-${crypto.randomUUID()}`;
  const email = `${crypto.randomUUID()}@example.test`;
  let updatedMetadata: Record<string, unknown> | undefined;
  await db.insert(adminUsersTable).values({ clerkUserId: actorId });
  try {
    const result = await updateAdminMemberProfile(
      actorId,
      targetId,
      { displayName: "  New name  ", sport: "baseball", teamName: null },
      {
        getUser: async () => fakeClerkUser(targetId, email) as any,
        updateUser: async (_id, metadata) => {
          updatedMetadata = metadata;
        },
        getMember: async () => ({
          clerkUserId: targetId,
          profile: {
            displayName: "New name",
            teamName: null,
            sport: "baseball",
          },
        }) as any,
      },
    );

    assert.equal(result?.profile.displayName, "New name");
    assert.equal(result?.profile.sport, "baseball");
    assert.equal(result?.profile.teamName, null);
    assert.equal(updatedMetadata?.retainedCustomValue, "keep");
    assert.equal(updatedMetadata?.displayName, "New name");
    assert.equal(updatedMetadata?.sport, "baseball");
    assert.equal(Object.hasOwn(updatedMetadata ?? {}, "teamName"), false);

    const [audit] = await db.select().from(adminActionAuditTable)
      .where(and(
        eq(adminActionAuditTable.actorClerkUserId, actorId),
        eq(adminActionAuditTable.targetClerkUserId, targetId),
        eq(adminActionAuditTable.action, "profile_updated"),
      ))
      .limit(1);
    assert.equal(audit?.status, "completed");
    assert.deepEqual(audit?.changedFields, ["displayName", "teamName", "sport"]);
  } finally {
    await cleanFixture([actorId, targetId]);
  }
});

test("administrator suspension is reversible, blocks normal account actions, and does not change lifecycle status", async () => {
  const actorId = `admin-suspension-${crypto.randomUUID()}`;
  const targetId = `member-suspension-${crypto.randomUUID()}`;
  await db.insert(adminUsersTable).values({ clerkUserId: actorId });
  await db.insert(accountAccessTable).values({
    ownerClerkUserId: targetId,
    role: "fan",
    accessMode: "full",
  });
  try {
    const suspended = await updateAdminMemberSuspension(actorId, targetId, true, "Policy review");
    assert.equal(suspended.status, "completed");
    const lifecycle = await getAccountLifecycleSnapshot(targetId);
    assert.equal(lifecycle.status, "active");
    assert.equal(lifecycle.adminSuspended, true);
    assert.equal(await isAccountActive(targetId), false);
    assert.equal(await pauseAccount(targetId), null);
    assert.equal(await cancelAccount(targetId), null);
    await withTestServer(async (baseUrl) => {
      const blocked = await fetch(`${baseUrl}/__test/private`, {
        headers: { "x-test-user": targetId },
      });
      assert.equal(blocked.status, 423);
      assert.deepEqual(await blocked.json(), {
        error: "This account is temporarily suspended by an administrator.",
        code: "ACCOUNT_ADMIN_SUSPENDED",
      });
    });

    await assert.rejects(
      updateAdminMemberSuspension(actorId, actorId, true),
      (error: unknown) => error instanceof AdminRequestError && error.statusCode === 409,
    );

    const restored = await updateAdminMemberSuspension(actorId, targetId, false, "Review complete");
    assert.equal(restored.status, "completed");
    const restoredLifecycle = await getAccountLifecycleSnapshot(targetId);
    assert.equal(restoredLifecycle.status, "active");
    assert.equal(restoredLifecycle.adminSuspended, false);
    assert.equal(await isAccountActive(targetId), true);

    const records = await db.select().from(adminActionAuditTable)
      .where(and(
        eq(adminActionAuditTable.actorClerkUserId, actorId),
        eq(adminActionAuditTable.targetClerkUserId, targetId),
      ));
    assert.deepEqual(records.map((record) => record.action).sort(), [
      "account_reactivated",
      "account_suspended",
    ]);
    assert.ok(records.every((record) => record.status === "completed"));
  } finally {
    await cleanFixture([actorId, targetId]);
  }
});

test("member deletion requires exact identity confirmation and persists a retryable audit request without touching Clerk in tests", async () => {
  const actorId = `admin-delete-${crypto.randomUUID()}`;
  const targetId = `member-delete-${crypto.randomUUID()}`;
  const wrongTargetId = `member-delete-wrong-${crypto.randomUUID()}`;
  const email = `${crypto.randomUUID()}@example.test`;
  let purgeCalls = 0;
  const user = fakeClerkUser(targetId, email);
  await db.insert(adminUsersTable).values({ clerkUserId: actorId });
  try {
    await assert.rejects(
      requestAdminMemberDeletion(
        actorId,
        targetId,
        "wrong@example.test",
        "Fixture deletion",
        {
          getUser: async () => user as any,
          runPurge: async () => {
            purgeCalls += 1;
          },
        },
      ),
      (error: unknown) => error instanceof AdminRequestError && error.statusCode === 400,
    );
    assert.equal(purgeCalls, 0);
    await assert.rejects(
      requestAdminMemberDeletion(
        actorId,
        actorId,
        actorId,
        "Attempted admin deletion",
        {
          getUser: async () => {
            throw new Error("Administrator deletion must stop before Clerk lookup");
          },
          runPurge: async () => {
            purgeCalls += 1;
          },
        },
      ),
      (error: unknown) => error instanceof AdminRequestError && error.statusCode === 409,
    );
    assert.equal(purgeCalls, 0);

    const action = await requestAdminMemberDeletion(
      actorId,
      targetId,
      email,
      "Fixture deletion",
      {
        getUser: async () => user as any,
        runPurge: async () => {
          purgeCalls += 1;
        },
      },
    );
    assert.equal(action?.action, "account_deleted");
    assert.equal(action?.status, "pending");
    assert.equal(purgeCalls, 1);

    const [access] = await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, targetId))
      .limit(1);
    assert.equal(access?.lifecycleStatus, "deletion_pending");
    assert.equal(access?.adminDeletionActionId, action?.id);

    const [audit] = await db.select().from(adminActionAuditTable)
      .where(eq(adminActionAuditTable.id, action!.id))
      .limit(1);
    assert.equal(audit?.actorClerkUserId, actorId);
    assert.equal(audit?.targetClerkUserId, targetId);
    assert.equal(audit?.reason, "Fixture deletion");

    const confirmedByAccountId = await requestAdminMemberDeletion(
      actorId,
      targetId,
      targetId,
      "Retry using account ID confirmation",
      {
        getUser: async () => user as any,
        runPurge: async () => {
          purgeCalls += 1;
        },
      },
    );
    assert.equal(confirmedByAccountId?.id, action.id);
    assert.equal(purgeCalls, 2);

    await assert.rejects(
      requestAdminMemberDeletion(
        actorId,
        wrongTargetId,
        "not-the-confirmation",
        "Fixture deletion",
        {
          getUser: async () => ({
            ...fakeClerkUser(wrongTargetId, ""),
            primaryEmailAddressId: null,
            emailAddresses: [],
          }) as any,
          runPurge: async () => undefined,
        },
      ),
      (error: unknown) => error instanceof AdminRequestError && error.statusCode === 400,
    );
  } finally {
    await cleanFixture([actorId, targetId, wrongTargetId]);
  }
});