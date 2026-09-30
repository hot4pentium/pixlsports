import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { eq } from "drizzle-orm";
import { accountAccessTable, db } from "@workspace/db";
import accountLifecycleRouter from "./routes/accountLifecycle";
import { createAccountAccessRouter } from "./routes/accountAccess";
import {
  createAccountProvisioning,
  type AccountProvisioningClerkClient,
} from "./lib/accountProvisioning";

test("first supporter save creates the account and Clerk-owned provisioning marker; transient Clerk failures can retry", async () => {
  const ownerClerkUserId = `first-save-${crypto.randomUUID()}`;
  let identity = {
    createdAt: Date.now() - 60_000,
    publicMetadata: {} as Record<string, unknown>,
    unsafeMetadata: {} as Record<string, unknown>,
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