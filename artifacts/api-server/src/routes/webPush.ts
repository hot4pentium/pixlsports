import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AcknowledgeNotificationDisplayedBody,
  AcknowledgeNotificationDisplayedParams,
  DeleteNotificationSubscriptionBody,
  SaveNotificationSubscriptionBody,
  UpdateNotificationPreferencesBody,
} from "@workspace/api-zod";
import {
  cloudProjectsTable,
  db,
  plannerNotificationDeliveriesTable,
  plannerNotificationPreferencesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { getWebPushConfig, isAllowedPushEndpoint, sendPushNotificationToUser } from "../lib/webPush";

const router: IRouter = Router();

// The VAPID public key and availability are safe to read before Clerk finishes
// initializing. Subscription changes and test alerts below remain authenticated.
router.get("/notifications/config", (_req, res): void => {
  const config = getWebPushConfig();
  res.json({ available: config.available, publicKey: config.available ? config.publicKey : null });
});

router.get("/notifications/preferences", requireAuth, async (_req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [preferences] = await db
    .select({
      oneHourBefore: plannerNotificationPreferencesTable.oneHourBefore,
      dayOf: plannerNotificationPreferencesTable.dayOf,
    })
    .from(plannerNotificationPreferencesTable)
    .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);

  res.json({
    oneHourBefore: preferences?.oneHourBefore ?? true,
    dayOf: preferences?.dayOf ?? false,
  });
});

router.patch("/notifications/preferences", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateNotificationPreferencesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid notification preferences." }); return; }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  try {
    const [preferences] = await db
      .insert(plannerNotificationPreferencesTable)
      .values({
        ownerClerkUserId,
        oneHourBefore: parsed.data.oneHourBefore,
        dayOf: parsed.data.dayOf,
      })
      .onConflictDoUpdate({
        target: plannerNotificationPreferencesTable.ownerClerkUserId,
        set: {
          oneHourBefore: parsed.data.oneHourBefore,
          dayOf: parsed.data.dayOf,
          updatedAt: new Date(),
        },
      })
      .returning({
        oneHourBefore: plannerNotificationPreferencesTable.oneHourBefore,
        dayOf: plannerNotificationPreferencesTable.dayOf,
      });
    res.json(preferences);
  } catch (error) {
    req.log.error({ err: error }, "Unable to save notification preferences");
    res.status(500).json({ error: "Unable to save notification preferences." });
  }
});

router.post("/notifications/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const parsed = SaveNotificationSubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid push subscription." }); return; }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  try {
    const endpoint = new URL(parsed.data.endpoint);
    if (!isAllowedPushEndpoint(endpoint.toString())) {
      res.status(400).json({ error: "Push endpoint must belong to a supported browser push service." });
      return;
    }
    const userAgent = req.get("user-agent")?.slice(0, 500) ?? null;
    const [existing] = await db.select({ ownerClerkUserId: webPushSubscriptionsTable.ownerClerkUserId })
      .from(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.endpoint, endpoint.toString()))
      .limit(1);
    if (existing && existing.ownerClerkUserId !== ownerClerkUserId) {
      const [details] = await db.select({
        p256dh: webPushSubscriptionsTable.p256dh,
        auth: webPushSubscriptionsTable.auth,
      }).from(webPushSubscriptionsTable)
        .where(eq(webPushSubscriptionsTable.endpoint, endpoint.toString())).limit(1);
      if (details?.p256dh === parsed.data.keys.p256dh && details.auth === parsed.data.keys.auth) {
        res.status(409).json({ error: "This device subscription belongs to another account." });
        return;
      }
      await db.delete(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.endpoint, endpoint.toString()));
    }
    await db.insert(webPushSubscriptionsTable).values({
      ownerClerkUserId, endpoint: endpoint.toString(), p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth, timezone: parsed.data.timezone ?? "UTC", userAgent,
    }).onConflictDoUpdate({
      target: webPushSubscriptionsTable.endpoint,
      set: {
        ownerClerkUserId,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        timezone: parsed.data.timezone ?? "UTC",
        userAgent,
        updatedAt: new Date(),
      },
    });
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Unable to save push subscription");
    res.status(500).json({ error: "Unable to save push subscription." });
  }
});

router.get("/notifications/subscriptions/status", requireAuth, async (req, res): Promise<void> => {
  const endpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : "";
  try {
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.href.length > 2048) throw new Error("invalid");
    const [existing] = await db.select({ ownerClerkUserId: webPushSubscriptionsTable.ownerClerkUserId })
      .from(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.endpoint, parsedEndpoint.toString())).limit(1);
    const ownerClerkUserId = getRequiredClerkUserId(res);
    res.json({
      owned: existing?.ownerClerkUserId === ownerClerkUserId,
      ownedByAnotherAccount: Boolean(existing && existing.ownerClerkUserId !== ownerClerkUserId),
    });
  } catch {
    res.status(400).json({ error: "Invalid push subscription endpoint." });
  }
});

router.delete("/notifications/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const parsed = DeleteNotificationSubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid push subscription." }); return; }
  try {
    const endpoint = new URL(parsed.data.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.href.length > 2048) {
      res.status(400).json({ error: "Push endpoint must use HTTPS." });
      return;
    }
    const ownerClerkUserId = getRequiredClerkUserId(res);
    await db.delete(webPushSubscriptionsTable).where(and(
      eq(webPushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId),
      eq(webPushSubscriptionsTable.endpoint, endpoint.toString()),
    ));
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Unable to remove push subscription");
    res.status(500).json({ error: "Unable to remove push subscription." });
  }
});

router.post("/notifications/deliveries/:deliveryId/displayed", async (req, res): Promise<void> => {
  const params = AcknowledgeNotificationDisplayedParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid notification delivery." }); return; }
  const parsed = AcknowledgeNotificationDisplayedBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid display receipt." }); return; }

  try {
    const [matchingDelivery] = await db
      .select({ id: plannerNotificationDeliveriesTable.id })
      .from(plannerNotificationDeliveriesTable)
      .innerJoin(
        cloudProjectsTable,
        eq(cloudProjectsTable.id, plannerNotificationDeliveriesTable.projectId),
      )
      .innerJoin(
        webPushSubscriptionsTable,
        and(
          eq(webPushSubscriptionsTable.ownerClerkUserId, cloudProjectsTable.ownerClerkUserId),
          eq(webPushSubscriptionsTable.endpoint, parsed.data.subscriptionEndpoint),
        ),
      )
      .where(eq(plannerNotificationDeliveriesTable.id, params.data.deliveryId))
      .limit(1);

    if (!matchingDelivery) {
      res.status(404).json({ error: "Notification delivery not found." });
      return;
    }

    await db
      .update(plannerNotificationDeliveriesTable)
      .set({ displayedAt: new Date() })
      .where(and(
        eq(plannerNotificationDeliveriesTable.id, params.data.deliveryId),
        isNull(plannerNotificationDeliveriesTable.displayedAt),
      ));
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Unable to record notification display receipt");
    res.status(500).json({ error: "Unable to record notification display receipt." });
  }
});

router.post("/notifications/test", requireAuth, async (req, res): Promise<void> => {
  if (!getWebPushConfig().available) { res.status(503).json({ error: "Push notifications are not configured on this server." }); return; }
  try {
    const result = await sendPushNotificationToUser(getRequiredClerkUserId(res), {
      title: "Pixl Sports is locked in",
      body: "Test alert received. You’re ready for Hype Card replies.",
      url: "/studio/profile",
      tag: "pixl-test-notification",
    });
    req.log.info(result, "Sent test push notification");
    if (result.sent === 0) {
      res.status(404).json({ error: "No live notification subscription received the test alert.", removed: result.removed });
      return;
    }
    res.status(202).end();
  } catch (error) {
    req.log.error({ err: error }, "Unable to send test push notification");
    res.status(500).json({ error: "Unable to send test notification." });
  }
});

export default router;