import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  cloudProjectsTable,
  db,
  plannerNotificationDeliveriesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import webPushRouter from "./routes/webPush";

test("notification display receipts are accepted only for the matching subscription", async () => {
  const ownerId = `display-receipt-test-${randomUUID()}`;
  const endpoint = `https://push.example.test/${randomUUID()}`;
  let projectId: string | undefined;
  let deliveryId: string | undefined;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", webPushRouter);
  const server = app.listen(0);

  try {
    await db.insert(webPushSubscriptionsTable).values({
      ownerClerkUserId: ownerId,
      endpoint,
      p256dh: "test-p256dh",
      auth: "test-auth",
      timezone: "America/New_York",
    });
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Display receipt test",
      project: { tool: "schedule", events: [] },
    }).returning({ id: cloudProjectsTable.id });
    projectId = project.id;
    const [delivery] = await db.insert(plannerNotificationDeliveriesTable).values({
      projectId,
      eventId: "event-1",
      notificationType: "one_hour",
      eventDate: "2026-09-23",
    }).returning({ id: plannerNotificationDeliveriesTable.id });
    deliveryId = delivery.id;

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const receiptUrl = `http://127.0.0.1:${address.port}/api/notifications/deliveries/${deliveryId}/displayed`;
    const rejected = await fetch(receiptUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscriptionEndpoint: `https://push.example.test/${randomUUID()}` }),
    });
    assert.equal(rejected.status, 404);

    const accepted = await fetch(receiptUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscriptionEndpoint: endpoint }),
    });
    assert.equal(accepted.status, 204);

    const [updatedDelivery] = await db
      .select({ displayedAt: plannerNotificationDeliveriesTable.displayedAt })
      .from(plannerNotificationDeliveriesTable)
      .where(eq(plannerNotificationDeliveriesTable.id, deliveryId));
    assert.ok(updatedDelivery?.displayedAt instanceof Date);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (deliveryId) {
      await db.delete(plannerNotificationDeliveriesTable)
        .where(eq(plannerNotificationDeliveriesTable.id, deliveryId));
    }
    if (projectId) {
      await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, projectId));
    }
    await db.delete(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerId));
  }
});