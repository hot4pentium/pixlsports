import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { DeleteNotificationSubscriptionBody, SaveNotificationSubscriptionBody } from "@workspace/api-zod";
import { db, webPushSubscriptionsTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { getWebPushConfig, sendPushNotificationToUser } from "../lib/webPush";

const router: IRouter = Router();

// The VAPID public key and availability are safe to read before Clerk finishes
// initializing. Subscription changes and test alerts below remain authenticated.
router.get("/notifications/config", (_req, res): void => {
  const config = getWebPushConfig();
  res.json({ available: config.available, publicKey: config.available ? config.publicKey : null });
});

router.post("/notifications/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const parsed = SaveNotificationSubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid push subscription." }); return; }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  try {
    const endpoint = new URL(parsed.data.endpoint);
    if (endpoint.protocol !== "https:") { res.status(400).json({ error: "Push endpoint must use HTTPS." }); return; }
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
    if (parsedEndpoint.protocol !== "https:" || endpoint.length > 2048) throw new Error("invalid");
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
    if (new URL(parsed.data.endpoint).protocol !== "https:") {
      res.status(400).json({ error: "Push endpoint must use HTTPS." });
      return;
    }
    const ownerClerkUserId = getRequiredClerkUserId(res);
    await db.delete(webPushSubscriptionsTable).where(and(
      eq(webPushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId),
      eq(webPushSubscriptionsTable.endpoint, parsed.data.endpoint),
    ));
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Unable to remove push subscription");
    res.status(500).json({ error: "Unable to remove push subscription." });
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