import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db,
  plannerNotificationPreferencesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import webPushRouter from "./routes/webPush";

test("phone-alert choices and device subscriptions survive unauthenticated requests and remain account-bound", async () => {
  const ownerId = `notification-preferences-test-${randomUUID()}`;
  const otherOwnerId = `notification-preferences-other-${randomUUID()}`;
  const endpoint = `https://fcm.googleapis.com/wp/${randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", webPushRouter);
  const server = app.listen(0);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/notifications`;
    const ownerHeaders = { "content-type": "application/json", "x-test-user": ownerId };
    const savedPreferences = {
      oneHourBefore: true,
      dayOf: true,
      timezone: "America/New_York",
    };

    const update = await fetch(`${baseUrl}/preferences`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify(savedPreferences),
    });
    assert.equal(update.status, 200);
    assert.deepEqual(await update.json(), savedPreferences);

    const signedOutRead = await fetch(`${baseUrl}/preferences`);
    assert.equal(signedOutRead.status, 401);

    const restoredPreferences = await fetch(`${baseUrl}/preferences`, { headers: ownerHeaders });
    assert.equal(restoredPreferences.status, 200);
    assert.deepEqual(await restoredPreferences.json(), savedPreferences);

    const otherAccountPreferences = await fetch(`${baseUrl}/preferences`, {
      headers: { "x-test-user": otherOwnerId },
    });
    assert.equal(otherAccountPreferences.status, 200);
    assert.deepEqual(await otherAccountPreferences.json(), {
      oneHourBefore: false,
      dayOf: false,
      timezone: null,
    });

    const saveSubscription = await fetch(`${baseUrl}/subscriptions`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        endpoint,
        timezone: "America/New_York",
        keys: { p256dh: "test-p256dh", auth: "test-auth" },
      }),
    });
    assert.equal(saveSubscription.status, 204);

    const restoredSubscription = await fetch(
      `${baseUrl}/subscriptions/status?endpoint=${encodeURIComponent(endpoint)}`,
      { headers: ownerHeaders },
    );
    assert.equal(restoredSubscription.status, 200);
    assert.deepEqual(await restoredSubscription.json(), {
      owned: true,
      ownedByAnotherAccount: false,
    });

    const otherAccountSubscription = await fetch(
      `${baseUrl}/subscriptions/status?endpoint=${encodeURIComponent(endpoint)}`,
      { headers: { "x-test-user": otherOwnerId } },
    );
    assert.equal(otherAccountSubscription.status, 200);
    assert.deepEqual(await otherAccountSubscription.json(), {
      owned: false,
      ownedByAnotherAccount: true,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerId));
    await db.delete(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerId));
  }
});