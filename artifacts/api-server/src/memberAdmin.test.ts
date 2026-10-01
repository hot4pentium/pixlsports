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
  isAdminUser,
  isLastAdmin,
} from "./lib/adminAccess";
import {
  AdminRequestError,
  requestAdminMemberDeletion,
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
    await withTestServer(async (baseUrl) => {
      const unauthenticated = await fetch(`${baseUrl}/admin/audit`);
      assert.equal(unauthenticated.status, 401);

      const denied = await fetch(`${baseUrl}/admin/members`, {
        headers: { "x-test-user": nonAdministratorId },
      });
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { error: "Administrator access is required." });

      const allowed = await fetch(`${baseUrl}/admin/audit`, {
        headers: { "x-test-user": administratorId },
      });
      assert.equal(allowed.status, 200);
      const body = await allowed.json() as { items: unknown[]; totalCount: number };
      assert.ok(Array.isArray(body.items));
      assert.ok(body.totalCount >= 0);
    });
  } finally {
    await cleanFixture([administratorId, nonAdministratorId]);
  }
});

test("production bootstrap requires the exact verified address and does not enroll disabled or unverified identities", async () => {
  const adminId = `admin-bootstrap-${crypto.randomUUID()}`;
  const disabledId = `admin-disabled-${crypto.randomUUID()}`;
  const unverifiedId = `admin-unverified-${crypto.randomUUID()}`;
  const address = `${crypto.randomUUID()}@example.test`;
  try {
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
  } finally {
    await cleanFixture([adminId, disabledId, unverifiedId]);
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