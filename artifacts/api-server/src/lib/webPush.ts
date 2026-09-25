import webpush from "web-push";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { db, webPushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";

const MAX_PAYLOAD_BYTES = 4096;
const ALLOWED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
]);

export function isAllowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || url.href.length > 2048 || isIP(host.replace(/^\[|\]$/g, ""))) return false;
    const vendorOrigin = ALLOWED_PUSH_HOSTS.has(host)
      || /^wns\d+-[a-z0-9-]+\.notify\.windows\.com$/.test(host);
    if (!vendorOrigin) return false;
    if (host === "fcm.googleapis.com") {
      return /^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:-]{10,}$/.test(url.pathname);
    }
    if (host.endsWith(".mozilla.com") || host === "push.services.mozilla.com") {
      return /^\/wpush\/v2\/[A-Za-z0-9_-]{10,}$/.test(url.pathname);
    }
    if (host === "web.push.apple.com") {
      return /^\/[A-Za-z0-9_-]{10,}(?:\/[A-Za-z0-9_-]+)*$/.test(url.pathname);
    }
    return (url.pathname === "/w/" && Boolean(url.searchParams.get("token")))
      || /^\/w\/[^/]{10,}$/.test(url.pathname);
  } catch {
    return false;
  }
}

export type PushNotificationPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  deliveryId?: string;
};

export function getWebPushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || null;
  const subject = process.env.VAPID_SUBJECT?.trim() || null;
  return { available: Boolean(publicKey && privateKey && subject), publicKey, privateKey, subject };
}

function configuredWebPush() {
  const config = getWebPushConfig();
  if (!config.available) return null;
  webpush.setVapidDetails(config.subject!, config.publicKey!, config.privateKey!);
  return webpush;
}

export function validatePushNotificationPayload(payload: PushNotificationPayload) {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Push notification payload exceeds 4096 bytes");
  }
  return serialized;
}

export async function sendPushNotificationToUser(ownerClerkUserId: string, payload: PushNotificationPayload) {
  const sender = configuredWebPush();
  if (!sender) return { configured: false, sent: 0, removed: 0 };
  const serialized = validatePushNotificationPayload(payload);
  const subscriptions = await db.select().from(webPushSubscriptionsTable)
    .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId));
  let sent = 0;
  let removed = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      await db.delete(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.id, subscription.id));
      removed += 1;
      return;
    }
    try {
      // web-push makes a single HTTPS request and rejects 3xx responses; it does not follow redirect targets.
      await sender.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, serialized);
      sent += 1;
    } catch (error: unknown) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await db.delete(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.id, subscription.id));
        removed += 1;
      } else {
        logger.warn({ err: error, subscriptionId: subscription.id }, "Unable to send web push notification");
      }
    }
  }));
  return { configured: true, sent, removed };
}

export async function sendPushNotificationToSubscription(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushNotificationPayload,
) {
  const sender = configuredWebPush();
  if (!sender) return { configured: false, sent: false, stale: false };
  if (!isAllowedPushEndpoint(subscription.endpoint)) return { configured: true, sent: false, stale: true };
  try {
    // web-push makes a single HTTPS request and rejects 3xx responses; it does not follow redirect targets.
    await sender.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, validatePushNotificationPayload(payload));
    return { configured: true, sent: true, stale: false };
  } catch (error: unknown) {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0;
    if (statusCode === 404 || statusCode === 410) return { configured: true, sent: false, stale: true };
    logger.warn({ err: error }, "Unable to send athlete invite fan push notification");
    return { configured: true, sent: false, stale: false };
  }
}