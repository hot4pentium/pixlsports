import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { eq, inArray, or } from "drizzle-orm";
import {
  accountAccessTable,
  adminActionAuditTable,
  adminIdentityBlocksTable,
  adminUsersTable,
  db,
} from "@workspace/db";
import accountLifecycleRouter from "./routes/accountLifecycle";
import { createAccountAccessRouter } from "./routes/accountAccess";
import {
  createAccountProvisioning,
  type AccountProvisioningClerkClient,
} from "./lib/accountProvisioning";
import { updateAdminMemberIdentityBlock } from "./lib/memberAdmin";

type TestClerkIdentity = {
  id: string;
  createdAt: number;
  publicMetadata: Record<string, unknown>;
  unsafeMetadata: Record<string, unknown>;
  emailAddresses: Array<{
    emailAddress: string;
    verification: { status: string };
  }>;
};

function createTestIdentity(
  id: string,
  emailAddress: string,
  verificationStatus = "verified",
): TestClerkIdentity {
  return {
    id,
    createdAt: Date.now() - 60_000,
    publicMetadata: {},
    unsafeMetadata: {},
    emailAddresses: [{ emailAddress, verification: { status: verificationStatus } }],
  };
}

function createTestClerk(identities: Map<string, TestClerkIdentity>) {
  return {
    users: {
      async getUser(userId: string) {
        const identity = identities.get(userId);
        if (!identity) throw Object.assign(new Error("Clerk user not found"), { status: 404 });
        return structuredClone(identity);
      },
      async getUserList({ emailAddress }: { emailAddress?: string[] }) {
        const requested = new Set((emailAddress ?? []).map((address) => address.trim().toLowerCase()));
        const matches = [...identities.values()].filter((identity) => identity.emailAddresses.some(
          (entry) => entry.verification.status === "verified"
            && requested.has(entry.emailAddress.trim().toLowerCase()),
        ));
        return { data: structuredClone(matches), totalCount: matches.length };
      },
      async updateUserMetadata(
        userId: string,
        metadata: { publicMetadata?: Record<string, unknown> },
      ) {
        const identity = identities.get(userId);
        assert.ok(identity);
        identity.publicMetadata = { ...identity.publicMetadata, ...metadata.publicMetadata };
        return structuredClone(identity);
      },
    },
  } as unknown as AccountProvisioningClerkClient;
}

function createAuthenticatedTestApp(
  provisioning: ReturnType<typeof createAccountProvisioning>,
) {
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
  app.use("/api", createAccountAccessRouter(provisioning));
  return app;
}

test("first supporter save creates the account and Clerk-owned provisioning marker; transient Clerk failures can retry", async () => {
  const ownerClerkUserId = `first-save-${crypto.randomUUID()}`;
  const verifiedEmail = `first-save-${crypto.randomUUID()}@example.test`;
  let identity = {
    id: ownerClerkUserId,
    createdAt: Date.now() - 60_000,
    publicMetadata: {} as Record<string, unknown>,
    unsafeMetadata: {} as Record<string, unknown>,
    emailAddresses: [{ emailAddress: verifiedEmail, verification: { status: "verified" } }],
  };
  let failNextIdentityRead = true;
  let metadataUpdates = 0;
  const controlledClerk = {
    users: {
      async getUser(userId: string) {
        assert.equal(userId, ownerClerkUserId);
        if (failNextIdentityRead) {
          failNextIdentityRead = false;
          throw new Error("Temporary Clerk outage");
        }
        return structuredClone(identity);
      },
      async getUserList({ emailAddress }: { emailAddress?: string[] }) {
        const matches = emailAddress?.some((address) => address.toLowerCase() === verifiedEmail.toLowerCase())
          ? [structuredClone(identity)]
          : [];
        return { data: matches, totalCount: matches.length };
      },
      async updateUserMetadata(
        userId: string,
        metadata: { publicMetadata?: Record<string, unknown> },
      ) {
        assert.equal(userId, ownerClerkUserId);
        metadataUpdates += 1;
        identity = {
          ...identity,
          publicMetadata: { ...identity.publicMetadata, ...metadata.publicMetadata },
        };
        return structuredClone(identity);
      },
    },
  } as unknown as AccountProvisioningClerkClient;
  const provisioning = createAccountProvisioning(() => controlledClerk);

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
  app.use("/api", createAccountAccessRouter(provisioning));
  app.use("/api", accountLifecycleRouter);
  const server = app.listen(0);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const headers = {
      "content-type": "application/json",
      "x-test-user": ownerClerkUserId,
    };
    const saveFirstAccount = () => fetch(`${baseUrl}/account/access`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ role: "fan", accessMode: "full" }),
    });

    const temporaryFailure = await saveFirstAccount();
    assert.equal(temporaryFailure.status, 503);
    assert.match((await temporaryFailure.json()).error, /try again/i);
    assert.deepEqual(identity.publicMetadata, {});
    assert.deepEqual(identity.unsafeMetadata, {});
    assert.deepEqual(await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId)), []);

    const stillUnprovisioned = await fetch(`${baseUrl}/account/lifecycle`, {
      headers: { "x-test-user": ownerClerkUserId },
    });
    assert.equal((await stillUnprovisioned.json()).status, "not_provisioned");

    const saved = await saveFirstAccount();
    assert.equal(saved.status, 200);
    const access = await saved.json();
    assert.equal(access.role, "fan");
    assert.equal(access.accessMode, "full");
    assert.equal(identity.publicMetadata.pixlSportsAccountProvisioned, true);
    assert.deepEqual(identity.unsafeMetadata, {}, "the browser cannot own or set the provisioning marker");
    assert.equal(metadataUpdates, 1);

    const activeLifecycle = await fetch(`${baseUrl}/account/lifecycle`, {
      headers: { "x-test-user": ownerClerkUserId },
    });
    assert.equal(activeLifecycle.status, 200);
    assert.equal((await activeLifecycle.json()).status, "active");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
  }
});

test("an Admin block wins when first-time setup is already in progress", async () => {
  const administratorId = `admin-setup-block-${crypto.randomUUID()}`;
  const ownerClerkUserId = `setup-block-race-${crypto.randomUUID()}`;
  const emailAddress = `setup-block-race-${crypto.randomUUID()}@example.test`;
  await db.insert(adminUsersTable).values({ clerkUserId: administratorId });
  const identities = new Map([[ownerClerkUserId, createTestIdentity(ownerClerkUserId, emailAddress)]]);
  const provisioning = createAccountProvisioning(() => createTestClerk(identities));
  const originalGetInitialSetup = provisioning.getInitialAccountSetup.bind(provisioning);
  let markSetupStarted!: () => void;
  const setupStarted = new Promise<void>((resolve) => { markSetupStarted = resolve; });
  let releaseSetup!: () => void;
  const setupGate = new Promise<void>((resolve) => { releaseSetup = resolve; });
  provisioning.getInitialAccountSetup = async (ownerId) => {
    const setup = await originalGetInitialSetup(ownerId);
    markSetupStarted();
    await setupGate;
    return setup;
  };

  const app = createAuthenticatedTestApp(provisioning);
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const request = fetch(`http://127.0.0.1:${address.port}/api/account/access`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-user": ownerClerkUserId,
      },
      body: JSON.stringify({ role: "fan", accessMode: "full" }),
    });
    await setupStarted;

    const block = await updateAdminMemberIdentityBlock(
      administratorId,
      ownerClerkUserId,
      true,
      "Prevent account creation during review",
    );
    assert.equal(block.action, "identity_blocked");
    releaseSetup();

    const response = await request;
    assert.equal(response.status, 423);
    assert.equal((await response.json()).code, "ACCOUNT_IDENTITY_BLOCKED");
    assert.deepEqual(await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId)), []);
  } finally {
    releaseSetup();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(adminIdentityBlocksTable)
      .where(eq(adminIdentityBlocksTable.clerkUserId, ownerClerkUserId));
    await db.delete(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    await db.delete(adminActionAuditTable)
      .where(or(
        eq(adminActionAuditTable.actorClerkUserId, administratorId),
        eq(adminActionAuditTable.targetClerkUserId, ownerClerkUserId),
      ));
    await db.delete(adminUsersTable).where(eq(adminUsersTable.clerkUserId, administratorId));
  }
});

test("a verified email blocks a new identity for every retained account lifecycle state", async () => {
  const identities = new Map<string, TestClerkIdentity>();
  const controlledClerk = createTestClerk(identities);
  const provisioning = createAccountProvisioning(() => controlledClerk);
  const app = createAuthenticatedTestApp(provisioning);
  const server = app.listen(0);
  const ownerClerkUserIds: string[] = [];
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const lifecycleCases = [
    { label: "active", lifecycleStatus: "active", lifecycleFields: {} },
    { label: "paused", lifecycleStatus: "paused", lifecycleFields: { pauseEndsAt: in90Days } },
    {
      label: "cancelled-in-recovery",
      lifecycleStatus: "cancelled",
      lifecycleFields: { cancelledAt: now, lastActivityAt: now, deletionEligibleAt: in90Days },
    },
    {
      label: "deletion-pending",
      lifecycleStatus: "deletion_pending",
      lifecycleFields: {
        cancelledAt: now,
        lastActivityAt: now,
        deletionEligibleAt: new Date(now.getTime() - 1),
        purgeStartedAt: now,
      },
    },
  ];

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    for (const lifecycleCase of lifecycleCases) {
      const emailAddress = `${lifecycleCase.label}-${crypto.randomUUID()}@example.test`;
      const existingOwnerId = `retained-${lifecycleCase.label}-${crypto.randomUUID()}`;
      const newOwnerId = `new-${lifecycleCase.label}-${crypto.randomUUID()}`;
      ownerClerkUserIds.push(existingOwnerId, newOwnerId);
      identities.set(existingOwnerId, createTestIdentity(existingOwnerId, emailAddress));
      identities.set(newOwnerId, createTestIdentity(newOwnerId, emailAddress));

      await db.insert(accountAccessTable).values({
        ownerClerkUserId: existingOwnerId,
        role: "fan",
        accessMode: "full",
        lifecycleStatus: lifecycleCase.lifecycleStatus,
        ...lifecycleCase.lifecycleFields,
      });

      const blockedAttempt = await fetch(`${baseUrl}/account/access`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-test-user": newOwnerId,
        },
        body: JSON.stringify({ role: "fan", accessMode: "full" }),
      });
      assert.equal(blockedAttempt.status, 409, `${lifecycleCase.label} account blocks duplicate provisioning`);
      const blockedBody = await blockedAttempt.json();
      assert.equal(blockedBody.code, "ACCOUNT_EMAIL_ALREADY_IN_USE");
      assert.equal(blockedBody.error.includes(emailAddress), false, "responses do not disclose the matched email");
      assert.deepEqual(
        await db.select().from(accountAccessTable)
          .where(eq(accountAccessTable.ownerClerkUserId, newOwnerId)),
        [],
      );

      if (lifecycleCase.lifecycleStatus === "active") {
        const sameIdentitySave = await fetch(`${baseUrl}/account/access`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-test-user": existingOwnerId,
          },
          body: JSON.stringify({ role: "fan", accessMode: "full" }),
        });
        assert.equal(sameIdentitySave.status, 200, "the retained account owner can continue their normal sign-in path");
      }

      await db.delete(accountAccessTable)
        .where(eq(accountAccessTable.ownerClerkUserId, existingOwnerId));
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const ownerClerkUserId of ownerClerkUserIds) {
      await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    }
  }
});

test("an existing identity keeps its account after its verified email changes, while a different identity stays blocked", async () => {
  const changedOwnerId = `changed-email-owner-${crypto.randomUUID()}`;
  const existingEmailOwnerId = `existing-email-owner-${crypto.randomUUID()}`;
  const newIdentityId = `new-changed-email-${crypto.randomUUID()}`;
  const oldEmail = `old-${crypto.randomUUID()}@example.test`;
  const sharedEmail = `shared-${crypto.randomUUID()}@example.test`;
  const identities = new Map<string, TestClerkIdentity>([
    [changedOwnerId, createTestIdentity(changedOwnerId, oldEmail)],
    [existingEmailOwnerId, createTestIdentity(existingEmailOwnerId, sharedEmail)],
    [newIdentityId, createTestIdentity(newIdentityId, sharedEmail)],
  ]);
  const changedOwner = identities.get(changedOwnerId);
  assert.ok(changedOwner);
  changedOwner.emailAddresses = [{ emailAddress: sharedEmail, verification: { status: "verified" } }];

  const provisioning = createAccountProvisioning(() => createTestClerk(identities));
  const app = createAuthenticatedTestApp(provisioning);
  const server = app.listen(0);
  const existingOwnerIds = [changedOwnerId, existingEmailOwnerId];

  try {
    await db.insert(accountAccessTable).values(existingOwnerIds.map((ownerClerkUserId) => ({
      ownerClerkUserId,
      role: "fan" as const,
      accessMode: "full" as const,
    })));

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/account/access`;
    const saveAs = (ownerClerkUserId: string) => fetch(baseUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-user": ownerClerkUserId,
      },
      body: JSON.stringify({ role: "fan", accessMode: "full" }),
    });

    const changedOwnerSave = await saveAs(changedOwnerId);
    assert.equal(changedOwnerSave.status, 200, "the changed email does not detach the original Clerk identity from its account");

    const existingEmailOwnerSave = await saveAs(existingEmailOwnerId);
    assert.equal(existingEmailOwnerSave.status, 200, "the account already linked to that email remains usable by its owner");

    const newIdentitySave = await saveAs(newIdentityId);
    assert.equal(newIdentitySave.status, 409, "a different identity cannot create an account using an already-linked verified email");
    assert.equal((await newIdentitySave.json()).code, "ACCOUNT_EMAIL_ALREADY_IN_USE");
    assert.deepEqual(
      await db.select().from(accountAccessTable)
        .where(inArray(accountAccessTable.ownerClerkUserId, [...existingOwnerIds, newIdentityId]))
        .then((rows) => rows.map((row) => row.ownerClerkUserId).sort()),
      [...existingOwnerIds].sort(),
      "both existing accounts remain attached to their original Clerk user IDs",
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const ownerClerkUserId of [...existingOwnerIds, newIdentityId]) {
      await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    }
  }
});

test("initial account setup requires a Clerk-verified email", async () => {
  const ownerClerkUserId = `unverified-${crypto.randomUUID()}`;
  const identities = new Map<string, TestClerkIdentity>([
    [ownerClerkUserId, createTestIdentity(
      ownerClerkUserId,
      `unverified-${crypto.randomUUID()}@example.test`,
      "unverified",
    )],
  ]);
  const provisioning = createAccountProvisioning(() => createTestClerk(identities));
  const app = createAuthenticatedTestApp(provisioning);
  const server = app.listen(0);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/account/access`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-user": ownerClerkUserId,
      },
      body: JSON.stringify({ role: "fan", accessMode: "full" }),
    });
    assert.equal(response.status, 423);
    assert.equal((await response.json()).code, "EMAIL_VERIFICATION_REQUIRED");
    assert.deepEqual(await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId)), []);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
  }
});

test("concurrent first saves with the same verified email create only one app account", async () => {
  const sharedEmail = `concurrent-${crypto.randomUUID()}@example.test`;
  const ownerClerkUserIds = [
    `concurrent-first-${crypto.randomUUID()}`,
    `concurrent-second-${crypto.randomUUID()}`,
  ];
  const identities = new Map(ownerClerkUserIds.map(
    (ownerClerkUserId) => [ownerClerkUserId, createTestIdentity(ownerClerkUserId, sharedEmail)] as const,
  ));
  const provisioning = createAccountProvisioning(() => createTestClerk(identities));
  const app = createAuthenticatedTestApp(provisioning);
  const server = app.listen(0);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/account/access`;
    const save = (ownerClerkUserId: string) => fetch(baseUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-user": ownerClerkUserId,
      },
      body: JSON.stringify({ role: "fan", accessMode: "full" }),
    });

    const responses = await Promise.all(ownerClerkUserIds.map(save));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const concurrentAccounts = await db.select().from(accountAccessTable)
      .where(inArray(accountAccessTable.ownerClerkUserId, ownerClerkUserIds));
    assert.equal(concurrentAccounts.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const ownerClerkUserId of ownerClerkUserIds) {
      await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    }
  }
});