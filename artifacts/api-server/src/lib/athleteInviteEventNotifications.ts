import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  athleteInviteEventDeliveryClaimsTable,
  athleteInviteEventLinksTable,
  athleteInviteFansTable,
  athleteInvitesTable,
  db,
  scheduleSharesTable,
  statTrackerSharesTable,
} from "@workspace/db";
import { isAccountActive } from "./accountLifecycle";
import { getAthleteInviteEventStartForTest } from "../jobs/athleteInviteFanAlerts";
import { GAME_ON_CARD_MARKER } from "../routes/scheduleShares";
import { isIanaTimezone } from "./timezone";
import { sendPushNotificationToSubscription } from "./webPush";

const MAX_PARALLEL_PUSHES = 8;

type PushSender = typeof sendPushNotificationToSubscription;
type EventRecord = Record<string, unknown>;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function getSingleEvent(events: unknown): EventRecord | null {
  if (!Array.isArray(events) || events.length !== 1) return null;
  const event: unknown = events[0];
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const item = event as EventRecord;
  return item.type === "game" || item.type === "practice" ? item : null;
}

function validUpcomingEvent(
  event: EventRecord,
  timezone: string | null,
  now: Date,
) {
  if (event.status === "final" || event.status === "live" || !isIanaTimezone(timezone)) return false;
  const start = getAthleteInviteEventStartForTest(event.date, event.time, timezone);
  return Boolean(start && start.getTime() > now.getTime());
}

async function currentTrackerStatus(tx: DbTransaction, ownerClerkUserId: string, event: EventRecord) {
  if (event.type !== "game" || typeof event.id !== "string") return null;
  const [tracker] = await tx.select({ game: statTrackerSharesTable.game })
    .from(statTrackerSharesTable).where(and(
      eq(statTrackerSharesTable.ownerClerkUserId, ownerClerkUserId),
      eq(statTrackerSharesTable.gameId, event.id),
    )).for("update").limit(1);
  const game = tracker?.game && typeof tracker.game === "object" && !Array.isArray(tracker.game)
    ? tracker.game as EventRecord
    : {};
  return game.status === "final" || game.status === "live" ? game.status : null;
}

async function validateInviteEvent(
  tx: DbTransaction,
  inviteId: string,
  ownerClerkUserId: string,
  shareToken: string,
) {
  const [invite] = await tx.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.id, inviteId),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    eq(athleteInvitesTable.paused, false),
  )).for("update").limit(1);
  if (!invite || !(await isAccountActive(ownerClerkUserId))) return null;
  const [link] = await tx.select({ id: athleteInviteEventLinksTable.id })
    .from(athleteInviteEventLinksTable).where(and(
      eq(athleteInviteEventLinksTable.inviteId, invite.id),
      eq(athleteInviteEventLinksTable.shareId, shareToken),
    )).limit(1);
  if (!link) return null;
  const [share] = await tx.select().from(scheduleSharesTable).where(and(
    eq(scheduleSharesTable.id, shareToken),
    eq(scheduleSharesTable.ownerClerkUserId, ownerClerkUserId),
    eq(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
  )).for("update").limit(1);
  const event = getSingleEvent(share?.events);
  if (!share || !event || typeof event.id !== "string") return null;
  const trackerStatus = await currentTrackerStatus(tx, ownerClerkUserId, event);
  if (event.status === "final" || event.status === "live" || trackerStatus === "final" || trackerStatus === "live"
    || !validUpcomingEvent(event, invite.timezone, new Date())) {
    return { invite, share, event, upcoming: false };
  }
  return { invite, share, event, upcoming: true };
}

async function claimDeviceDelivery(
  inviteId: string,
  ownerClerkUserId: string,
  shareToken: string,
  eventId: string,
  followId: string,
) {
  return db.transaction(async (tx) => {
    const validated = await validateInviteEvent(tx, inviteId, ownerClerkUserId, shareToken);
    if (!validated?.upcoming || validated.event.id !== eventId) return { state: "stale" as const };
    const [follow] = await tx.select().from(athleteInviteFansTable).where(and(
      eq(athleteInviteFansTable.id, followId),
      eq(athleteInviteFansTable.inviteId, inviteId),
      eq(athleteInviteFansTable.preEventAlerts, true),
    )).for("update").limit(1);
    if (!follow) return { state: "stale" as const };
    const deviceKeyHash = createHash("sha256").update(follow.endpoint).digest("hex");
    const [claim] = await tx.insert(athleteInviteEventDeliveryClaimsTable).values({
      inviteId,
      shareId: shareToken,
      eventId,
      deviceKeyHash,
      result: "claimed",
    }).onConflictDoNothing().returning({ id: athleteInviteEventDeliveryClaimsTable.id });
    if (!claim) {
      const [existing] = await tx.select({ result: athleteInviteEventDeliveryClaimsTable.result })
        .from(athleteInviteEventDeliveryClaimsTable).where(and(
          eq(athleteInviteEventDeliveryClaimsTable.inviteId, inviteId),
          eq(athleteInviteEventDeliveryClaimsTable.eventId, eventId),
          eq(athleteInviteEventDeliveryClaimsTable.deviceKeyHash, deviceKeyHash),
        )).limit(1);
      return { state: "duplicate" as const, result: existing?.result ?? "claimed", deviceKeyHash };
    }
    return { state: "claimed" as const, claimId: claim.id, follow };
  });
}

async function sendClaimedDelivery(
  inviteId: string,
  ownerClerkUserId: string,
  shareToken: string,
  eventId: string,
  followId: string,
  claimId: string,
  payload: Parameters<PushSender>[1],
  send: PushSender,
  now: () => Date,
) {
  const currentFollow = await db.transaction(async (tx) => {
    const validated = await validateInviteEvent(tx, inviteId, ownerClerkUserId, shareToken);
    const [follow] = validated?.upcoming && validated.event.id === eventId
      ? await tx.select().from(athleteInviteFansTable).where(and(
        eq(athleteInviteFansTable.id, followId),
        eq(athleteInviteFansTable.inviteId, inviteId),
        eq(athleteInviteFansTable.preEventAlerts, true),
      )).for("update").limit(1)
      : [];
    if (!follow) {
      await tx.delete(athleteInviteEventDeliveryClaimsTable)
        .where(eq(athleteInviteEventDeliveryClaimsTable.id, claimId));
      return null;
    }
    return follow;
  });
  if (!currentFollow) return { state: "stale" as const };

  // The short transaction above is the final eligibility/consent check.
  // Do not hold the invite/share/follower locks during the network request:
  // slow push services must not block other recipients or preference changes.
  let outcome: Awaited<ReturnType<PushSender>>;
  try {
    outcome = await send(currentFollow, payload);
  } catch {
    outcome = { configured: true, sent: false, stale: false };
  }
  await db.transaction(async (tx) => {
    await tx.update(athleteInviteEventDeliveryClaimsTable).set({
      result: outcome.sent ? "sent" : "failed",
      completedAt: now(),
    }).where(eq(athleteInviteEventDeliveryClaimsTable.id, claimId));
    if (outcome.stale) {
      await tx.delete(athleteInviteFansTable).where(and(
        eq(athleteInviteFansTable.id, followId),
        eq(athleteInviteFansTable.endpoint, currentFollow.endpoint),
      ));
    }
  });
  return { state: outcome.sent ? "sent" as const : "failed" as const };
}

async function awaitExistingDeliveryResult(inviteId: string, eventId: string, deviceKeyHash: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const [claim] = await db.select({ result: athleteInviteEventDeliveryClaimsTable.result })
      .from(athleteInviteEventDeliveryClaimsTable).where(and(
        eq(athleteInviteEventDeliveryClaimsTable.inviteId, inviteId),
        eq(athleteInviteEventDeliveryClaimsTable.eventId, eventId),
        eq(athleteInviteEventDeliveryClaimsTable.deviceKeyHash, deviceKeyHash),
      )).limit(1);
    if (!claim || claim.result !== "claimed") return claim?.result ?? "failed";
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return "failed";
}

export async function notifyAthleteInviteEventFollowers(
  inviteToken: string,
  ownerClerkUserId: string,
  shareToken: string,
  options: { send?: PushSender; now?: () => Date } = {},
) {
  const [invite] = await db.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  )).limit(1);
  if (!invite || invite.paused || !(await isAccountActive(ownerClerkUserId))) {
    return { status: "not-found" as const };
  }

  const initial = await db.transaction(async (tx) => {
    const validated = await validateInviteEvent(tx, invite.id, ownerClerkUserId, shareToken);
    if (!validated) return "not-found" as const;
    if (!validated.upcoming) return "not-upcoming" as const;
    return { eventId: validated.event.id as string };
  });
  if (initial === "not-found") return { status: "not-found" as const };
  if (initial === "not-upcoming") return { status: "not-upcoming" as const };

  const followers = await db.select({ id: athleteInviteFansTable.id })
    .from(athleteInviteFansTable).where(and(
      eq(athleteInviteFansTable.inviteId, invite.id),
      eq(athleteInviteFansTable.preEventAlerts, true),
    ));
  const counts = { attempted: 0, sent: 0, failed: 0, alreadySent: 0 };
  const send = options.send ?? sendPushNotificationToSubscription;
  const batches = Array.from({ length: Math.ceil(followers.length / MAX_PARALLEL_PUSHES) }, (_, batchIndex) => (
    followers.slice(batchIndex * MAX_PARALLEL_PUSHES, (batchIndex + 1) * MAX_PARALLEL_PUSHES)
  ));
  for (const batch of batches) {
    await Promise.all(batch.map(async ({ id: followId }) => {
      const claim = await claimDeviceDelivery(invite.id, ownerClerkUserId, shareToken, initial.eventId, followId);
      if (claim.state === "stale") return;
      if (claim.state === "duplicate") {
        const result = claim.result === "claimed"
          ? await awaitExistingDeliveryResult(invite.id, initial.eventId, claim.deviceKeyHash)
          : claim.result;
        if (result === "sent") counts.alreadySent += 1;
        else counts.failed += 1;
        return;
      }
      const outcome = await sendClaimedDelivery(
        invite.id,
        ownerClerkUserId,
        shareToken,
        initial.eventId,
        followId,
        claim.claimId,
        {
          title: `${invite.athleteName} has a game-day card`,
          body: "You enabled event alerts for a Hype Card you follow. There's a game-day card to see.",
          url: `/fan/${invite.publicToken}`,
          tag: `athlete-invite-event-${invite.id}-${initial.eventId}`,
        },
        send,
        options.now ?? (() => new Date()),
      );
      if (outcome.state === "stale") return;
      counts.attempted += 1;
      if (outcome.state === "sent") counts.sent += 1;
      else counts.failed += 1;
    }));
  }
  return { status: "ok" as const, ...counts };
}