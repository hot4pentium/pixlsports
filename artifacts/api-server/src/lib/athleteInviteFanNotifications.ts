import { and, eq, gt } from "drizzle-orm";
import {
  athleteInviteFanDeliveriesTable,
  athleteInviteFansTable,
  athleteInvitesTable,
  db,
  statTrackerSharesTable,
} from "@workspace/db";
import { isAccountActive } from "./accountLifecycle";
import { sendPushNotificationToSubscription } from "./webPush";

export type AthleteInviteFanAlert = "live" | "event";
type SendFanNotification = typeof sendPushNotificationToSubscription;

export async function notifyAthleteInviteFans(
  inviteId: string,
  eventKey: string,
  alert: AthleteInviteFanAlert,
  options: { liveShareId?: string; send?: SendFanNotification } = {},
) {
  const [invite] = await db.select().from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.id, inviteId)).limit(1);
  if (!invite || invite.paused
    || !(await isAccountActive(invite.ownerClerkUserId))
    || (alert === "live" && (!options.liveShareId || invite.liveTrackerShareToken !== options.liveShareId))) {
    return { sent: 0, removed: 0 };
  }
  if (alert === "live") {
    const [share] = await db.select({ id: statTrackerSharesTable.id })
      .from(statTrackerSharesTable).where(and(
        eq(statTrackerSharesTable.id, options.liveShareId!),
        eq(statTrackerSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
        eq(statTrackerSharesTable.gameId, eventKey),
        gt(statTrackerSharesTable.expiresAt, new Date()),
      )).limit(1);
    if (!share) return { sent: 0, removed: 0 };
  }

  const notificationType = `${alert}_alert`;
  const deliveryEventKey = alert === "live" ? `${eventKey}:${options.liveShareId}` : eventKey;
  const [delivery] = await db.insert(athleteInviteFanDeliveriesTable).values({
    inviteId,
    eventKey: deliveryEventKey,
    notificationType,
  }).onConflictDoNothing().returning({ id: athleteInviteFanDeliveriesTable.id });
  if (!delivery) return { sent: 0, removed: 0 };

  const subscriptions = await db.select().from(athleteInviteFansTable).where(and(
    eq(athleteInviteFansTable.inviteId, inviteId),
    alert === "live"
      ? eq(athleteInviteFansTable.liveAlerts, true)
      : eq(athleteInviteFansTable.eventAlerts, true),
  ));
  let sent = 0;
  let removed = 0;
  const title = alert === "live" ? "Game Day Live" : "Game day starts now";
  const body = alert === "live" ? `${invite.athleteName} is live now.` : `${invite.athleteName}'s scheduled event is starting.`;
  for (const subscription of subscriptions) {
    const [currentFollow] = await db.select().from(athleteInviteFansTable).where(and(
      eq(athleteInviteFansTable.id, subscription.id),
      eq(athleteInviteFansTable.inviteId, inviteId),
      alert === "live"
        ? eq(athleteInviteFansTable.liveAlerts, true)
        : eq(athleteInviteFansTable.eventAlerts, true),
    )).limit(1);
    if (!currentFollow) continue;
    const [currentInvite] = await db.select().from(athleteInvitesTable).where(and(
      eq(athleteInvitesTable.id, inviteId),
      eq(athleteInvitesTable.paused, false),
    )).limit(1);
    if (!currentInvite
      || (alert === "live" && currentInvite.liveTrackerShareToken !== options.liveShareId)) break;
    if (alert === "live") {
      const [activeShare] = await db.select({ id: statTrackerSharesTable.id })
        .from(statTrackerSharesTable).where(and(
          eq(statTrackerSharesTable.id, options.liveShareId!),
          eq(statTrackerSharesTable.ownerClerkUserId, currentInvite.ownerClerkUserId),
          eq(statTrackerSharesTable.gameId, eventKey),
          gt(statTrackerSharesTable.expiresAt, new Date()),
        )).limit(1);
      if (!activeShare) break;
    }
    if (!(await isAccountActive(currentInvite.ownerClerkUserId))) break;

    const result = await (options.send ?? sendPushNotificationToSubscription)(currentFollow, {
      title,
      body,
      url: `/fan/${invite.publicToken}`,
      tag: `athlete-invite-${inviteId}-${notificationType}-${eventKey}`,
    });
    if (result.sent) sent += 1;
    if (result.stale) {
      await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.id, subscription.id));
      removed += 1;
    }
  }
  return { sent, removed };
}