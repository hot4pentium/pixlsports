import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, webPushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";

const MAX_PAYLOAD_BYTES = 4096;

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
    try {
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