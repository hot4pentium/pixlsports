import { createClerkClient } from "@clerk/express";
import { Router, raw, type RequestHandler } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  BeginNativeAccountLinkBody, PollNativeAccountLinkBody,
  PreviewWebNativeAccountLinkBody, DecideWebNativeAccountLinkBody,
  CreateScheduleShareBody, GetNativeSupporterHypeCardResponse,
  UpdateNativeSupporterHypeCardBody, UpdateNativeSupporterHypeCardResponse,
  CorrectNativeSupporterHypeCardIdentityBody,
  CorrectNativeSupporterHypeCardIdentityResponse,
  UpdateNativeSupporterProfileBody,
  GetNativeSupporterScheduleResponse,
  GetAthleteInviteFanBaseResponse,
  PrepareNativeSupporterAccountResponse,
} from "@workspace/api-zod";
import { prepareNativeSupporterAccount } from "../lib/nativeAccountPreparation";
import { nativeAccountLinkService as service, limitNativeLinkAction } from "../lib/nativeAccountLink";
import { NativeLinkError, nativeIssuer, nativeLinkWebOrigin, verifyNativeIdentity, type NativeIdentity } from "../lib/nativeIdentity";
import {
  createNativeSupporterEventCard,
  loadNativeSupporterSchedule,
  updateNativeSupporterEventCard,
} from "../lib/nativeSupporterSchedule";
import {
  correctNativeSupporterHypeCardIdentity,
  loadNativeSupporterHypeCard,
  loadNativeSupporterFanBase,
  loadNativeSupporterHypeCardPhoto,
  updateNativeSupporterHypeCard,
} from "../lib/nativeSupporterHypeCard";
import {
  loadNativeSupporterProfile,
  updateNativeSupporterProfile,
} from "../lib/nativeSupporterProfile";
import { getRequiredClerkUserId, requireAuth, requireAuthenticatedIdentity } from "../middlewares/requireAuth";
import { isIanaTimezone } from "../lib/timezone";
import {
  isGameOnAlertScheduleEnabled,
  queueGameOnOwnerSync,
  reconcileGameOnShare,
} from "../jobs/gameOnReminderQueue";
import { z } from "zod/v4";
import { nativeWorkspaceCommand } from "../lib/nativeEventTracker";
import { nativeEventWorkspace } from "../lib/nativeEventWorkspace";
import { notifyStatTrackerShareUpdate } from "./statTrackerShares";
import { nativeLiveTapAccess } from "../lib/nativeLiveTapAccess";
import {
  db,
  nativeAccountLinksTable,
  nativePushSubscriptionsTable,
  plannerNotificationPreferencesTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { getApnsConfig } from "../lib/apns";
import { nativeAthletePhoto } from "../lib/nativeAthletePhoto";
import { checkPhotoStorageReadiness, photoStorageUnavailableMessage } from "../lib/photoStorageReadiness";
import { nativePhotoFailureResponse, type NativePhotoOperation } from "../lib/nativeAthletePhotoDiagnostics";
import { GetNativeAthletePhotoStateResponse, RemoveNativeAthletePhotoBody } from "@workspace/api-zod";
import { RequestNativeAccountDeletionBody, RequestNativeAccountDeletionResponse, GetNativeAccountDeletionResponse } from "@workspace/api-zod";
import { assertNativeNotDeleting, previewNativeAccountDeletion, requestNativeAccountDeletion } from "../lib/nativeAccountDeletion";
import { runNativeAccountDeletions } from "../jobs/nativeAccountDeletions";

const handle: (fn: RequestHandler, photoOperation?: NativePhotoOperation) => RequestHandler = (fn, photoOperation) => async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try { await fn(req, res, next); } catch (error) {
    if (photoOperation) {
      const failure = nativePhotoFailureResponse(photoOperation, error);
      if (failure.status === 429) res.setHeader("Retry-After", "600");
      if (failure.diagnostic.category === "infrastructure") {
        req.log.error(failure.diagnostic, "Native athlete photo operation failed");
      } else {
        req.log.warn(failure.diagnostic, "Native athlete photo operation rejected");
      }
      res.status(failure.status).json(failure.body);
      return;
    }
    if (error instanceof NativeLinkError) {
      if (error.status === 429) res.setHeader("Retry-After", "600");
      res.status(error.status).json({ error: error.message });
    } else {
      // Do not log token/verifier/code bodies or third-party auth responses.
      req.log.error("Native PIXL operation failed");
      res.status(503).json({ error: "PIXL Sports is temporarily unavailable. Please try again." });
    }
  }
};

export const nativeAccountLinkRouter = Router();
nativeAccountLinkRouter.use(handle(async (req, res, next) => {
  const header = req.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 12000) {
    throw new NativeLinkError(401, "Sign in to the iPhone app again.");
  }
  // This router is mounted BEFORE the PWA's Clerk middleware and ignores cookies.
  const who = await verifyNativeIdentity(header.slice(7));
  res.locals.nativeIdentity = who;
  await limitNativeLinkAction(JSON.stringify(who), "native-request", 300);
  // Only preview/retry of the removal request survives the terminal marker.
  if (req.path !== "/account/deletion") await assertNativeNotDeleting(who);
  next();
}));
const identity = (res: { locals: Record<string, unknown> }) => res.locals.nativeIdentity as NativeIdentity;
nativeAccountLinkRouter.get("/account/deletion", handle(async (_req, res) => {
  res.json(GetNativeAccountDeletionResponse.parse(await previewNativeAccountDeletion(identity(res))));
}));
nativeAccountLinkRouter.post("/account/deletion", handle(async (req, res) => {
  const parsed = RequestNativeAccountDeletionBody.strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Review and confirm account removal first.");
  const result = await requestNativeAccountDeletion(identity(res), parsed.data);
  // The committed request, not a provider response, is authoritative. Failures
  // stay queued and are retried by the scheduled caller and startup worker.
  res.status(202).json(RequestNativeAccountDeletionResponse.parse(result));
  void runNativeAccountDeletions(undefined, identity(res)).catch(() => {
    req.log.warn("iPhone account removal remains queued for retry");
  });
}));
nativeAccountLinkRouter.post("/supporter/account", handle(async (req, res) => {
  if (!z.object({}).strict().safeParse(req.body ?? {}).success) {
    throw new NativeLinkError(400, "Account setup does not accept identity or permission fields.");
  }
  const who = identity(res);
  await limitNativeLinkAction(JSON.stringify(who), "native-account-setup", 10);
  res.json(PrepareNativeSupporterAccountResponse.parse(await prepareNativeSupporterAccount(who)));
}));
const NativeDeviceSubscriptionBody = z.object({
  deviceId: z.uuid(),
  deviceToken: z.string().regex(/^[a-f0-9]{64}$/i),
  environment: z.enum(["sandbox", "production"]),
}).strict();
const NativeDeviceRemovalBody = z.object({
  deviceId: z.uuid(),
  environment: z.enum(["sandbox", "production"]),
}).strict();
const NativeNotificationPreferencesBody = z.object({
  oneHourBefore: z.boolean(),
  dayOf: z.boolean(),
  timezone: z.string().min(1).max(100),
}).strict();

async function linkedOwner(who: NativeIdentity) {
  const [link] = await db.select({
    ownerClerkUserId: nativeAccountLinksTable.ownerClerkUserId,
  }).from(nativeAccountLinksTable).where(and(
    eq(nativeAccountLinksTable.nativeIssuer, who.issuer),
    eq(nativeAccountLinksTable.nativeSubject, who.subject),
  )).limit(1);
  if (!link) throw new NativeLinkError(409, "Connect your PIXL account before setting Event Card alerts.");
  return link.ownerClerkUserId;
}

async function unregisterNativePushForIdentity(who: NativeIdentity) {
  const removed = await db.delete(nativePushSubscriptionsTable).where(and(
    eq(nativePushSubscriptionsTable.nativeIssuer, who.issuer),
    eq(nativePushSubscriptionsTable.nativeSubject, who.subject),
  )).returning({ ownerClerkUserId: nativePushSubscriptionsTable.ownerClerkUserId });
  for (const ownerClerkUserId of new Set(removed.map((row) => row.ownerClerkUserId))) {
    try { await queueGameOnOwnerSync(ownerClerkUserId); } catch { /* Global reconciliation will recover. */ }
  }
}

async function unregisterNativePushForOwner(ownerClerkUserId: string) {
  await db.delete(nativePushSubscriptionsTable)
    .where(eq(nativePushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId));
  try { await queueGameOnOwnerSync(ownerClerkUserId); } catch { /* Global reconciliation will recover. */ }
}

nativeAccountLinkRouter.get("/notifications/config", handle(async (_req, res) => {
  const apns = getApnsConfig();
  const scheduledDeliveryEnabled = apns.available && await isGameOnAlertScheduleEnabled();
  res.json({ available: apns.available, scheduledDeliveryEnabled });
}));
nativeAccountLinkRouter.get("/notifications/preferences", handle(async (_req, res) => {
  const ownerClerkUserId = await linkedOwner(identity(res));
  const [[preferences], [subscription]] = await Promise.all([
    db.select({
      oneHourBefore: plannerNotificationPreferencesTable.oneHourBefore,
      dayOf: plannerNotificationPreferencesTable.dayOf,
      timezone: plannerNotificationPreferencesTable.timezone,
    }).from(plannerNotificationPreferencesTable)
      .where(eq(plannerNotificationPreferencesTable.ownerClerkUserId, ownerClerkUserId)).limit(1),
    db.select({ timezone: webPushSubscriptionsTable.timezone })
      .from(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.ownerClerkUserId, ownerClerkUserId))
      .orderBy(desc(webPushSubscriptionsTable.updatedAt))
      .limit(1),
  ]);
  res.json({
    oneHourBefore: preferences?.oneHourBefore ?? false,
    dayOf: preferences?.dayOf ?? false,
    timezone: preferences?.timezone ?? subscription?.timezone ?? null,
  });
}));
nativeAccountLinkRouter.patch("/notifications/preferences", handle(async (req, res) => {
  const parsed = NativeNotificationPreferencesBody.safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Choose valid Event Card reminder settings.");
  if (!isIanaTimezone(parsed.data.timezone)) throw new NativeLinkError(400, "Choose a valid time zone.");
  const ownerClerkUserId = await linkedOwner(identity(res));
  const who = identity(res);
  const [preferences] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(761119995)`);
    const deleting = await tx.execute(sql`SELECT 1 FROM native_account_deletions
      WHERE native_issuer=${who.issuer} AND native_subject=${who.subject}`);
    if (deleting.rowCount) throw new NativeLinkError(423, "iPhone account removal has been requested.");
    return tx.insert(plannerNotificationPreferencesTable).values({
      ownerClerkUserId,
      ...parsed.data,
    }).onConflictDoUpdate({
      target: plannerNotificationPreferencesTable.ownerClerkUserId,
      set: { ...parsed.data, updatedAt: new Date() },
    }).returning({
      oneHourBefore: plannerNotificationPreferencesTable.oneHourBefore,
      dayOf: plannerNotificationPreferencesTable.dayOf,
      timezone: plannerNotificationPreferencesTable.timezone,
    });
  });
  try {
    await queueGameOnOwnerSync(ownerClerkUserId);
  } catch {
    req.log.warn("Native Event Card alert preferences saved; reminder scheduling needs reconciliation");
  }
  res.json(preferences);
}));
nativeAccountLinkRouter.get("/notifications/subscriptions", handle(async (_req, res) => {
  const who = identity(res);
  const deviceId = typeof _req.query.deviceId === "string" ? _req.query.deviceId : "";
  const environment = _req.query.environment === "sandbox" || _req.query.environment === "production"
    ? _req.query.environment : "";
  if (!z.uuid().safeParse(deviceId).success || !environment) {
    throw new NativeLinkError(400, "Invalid iPhone notification device.");
  }
  const [subscription] = await db.select({ id: nativePushSubscriptionsTable.id })
    .from(nativePushSubscriptionsTable).where(and(
      eq(nativePushSubscriptionsTable.nativeIssuer, who.issuer),
      eq(nativePushSubscriptionsTable.nativeSubject, who.subject),
      eq(nativePushSubscriptionsTable.deviceId, deviceId),
      eq(nativePushSubscriptionsTable.environment, environment),
    )).limit(1);
  res.json({ enabled: Boolean(subscription), available: getApnsConfig().available });
}));
nativeAccountLinkRouter.post("/notifications/subscriptions", handle(async (req, res) => {
  if (!getApnsConfig().available) {
    throw new NativeLinkError(503, "iPhone alerts are not configured on this server yet.");
  }
  const parsed = NativeDeviceSubscriptionBody.safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Invalid iPhone notification registration.");
  const who = identity(res);
  const ownerClerkUserId = await linkedOwner(who);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(761119995)`);
    const deleting = await tx.execute(sql`SELECT 1 FROM native_account_deletions
      WHERE native_issuer=${who.issuer} AND native_subject=${who.subject}`);
    if (deleting.rowCount) throw new NativeLinkError(423, "iPhone account removal has been requested.");
    await tx.delete(nativePushSubscriptionsTable).where(and(
      eq(nativePushSubscriptionsTable.deviceToken, parsed.data.deviceToken),
      eq(nativePushSubscriptionsTable.environment, parsed.data.environment),
      ne(nativePushSubscriptionsTable.deviceId, parsed.data.deviceId),
    ));
    await tx.insert(nativePushSubscriptionsTable).values({
      ...parsed.data,
      ownerClerkUserId,
      nativeIssuer: who.issuer,
      nativeSubject: who.subject,
    }).onConflictDoUpdate({
      target: [nativePushSubscriptionsTable.deviceId, nativePushSubscriptionsTable.environment],
      set: {
        deviceToken: parsed.data.deviceToken,
        ownerClerkUserId,
        nativeIssuer: who.issuer,
        nativeSubject: who.subject,
        updatedAt: new Date(),
      },
    });
  });
  try {
    await queueGameOnOwnerSync(ownerClerkUserId);
  } catch {
    req.log.warn("Native iPhone alert registration saved; reminder scheduling needs reconciliation");
  }
  res.json({ enabled: true });
}));
nativeAccountLinkRouter.delete("/notifications/subscriptions", handle(async (req, res) => {
  const parsed = NativeDeviceRemovalBody.safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Invalid iPhone notification registration.");
  const who = identity(res);
  const [removed] = await db.delete(nativePushSubscriptionsTable).where(and(
    eq(nativePushSubscriptionsTable.nativeIssuer, who.issuer),
    eq(nativePushSubscriptionsTable.nativeSubject, who.subject),
    eq(nativePushSubscriptionsTable.deviceId, parsed.data.deviceId),
    eq(nativePushSubscriptionsTable.environment, parsed.data.environment),
  )).returning({ ownerClerkUserId: nativePushSubscriptionsTable.ownerClerkUserId });
  if (removed) {
    try {
      await queueGameOnOwnerSync(removed.ownerClerkUserId);
    } catch {
      req.log.warn("Native iPhone notification registration removed; reminder scheduling needs reconciliation");
    }
  }
  res.json({ enabled: false });
}));
const NativeEventCardEditBody = z.object({
  eventId: z.uuid(),
  type: z.enum(["game", "practice"]),
  date: z.string().length(10),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(100),
  location: z.string().max(300),
  opponent: z.string().max(200),
}).strict();
function isValidNativeEventDate(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === date;
}

nativeAccountLinkRouter.get("/link", handle(async (_req, res) => {
  res.json(await service.current(identity(res)));
}));
nativeAccountLinkRouter.delete("/link", handle(async (_req, res) => {
  const who = identity(res);
  const result = await service.disconnect(who);
  await unregisterNativePushForIdentity(who);
  res.json(result);
}));
nativeAccountLinkRouter.get("/supporter/schedule", handle(async (_req, res) => {
  res.json(GetNativeSupporterScheduleResponse.parse(await loadNativeSupporterSchedule(identity(res))));
}));
nativeAccountLinkRouter.get("/supporter/fan-base", handle(async (_req, res) => {
  const summary = await loadNativeSupporterFanBase(identity(res));
  if (!summary) throw new NativeLinkError(404, "No HYPE Card is available for this athlete.");
  res.json(GetAthleteInviteFanBaseResponse.parse(summary));
}));
nativeAccountLinkRouter.post("/supporter/live-taps-access", handle(async (req, res) => {
  const parsed = z.object({
    shareToken: z.uuid(),
    action: z.enum(["list", "create", "revoke"]),
    accessId: z.uuid().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Choose a valid Event Card and fan QR action.");
  res.json(await nativeLiveTapAccess(identity(res), parsed.data.shareToken, parsed.data.action, parsed.data.accessId));
}));
nativeAccountLinkRouter.post("/supporter/event-workspace", handle(async (req, res) => {
  const parsed = z.object({ shareToken: z.uuid() }).strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Choose a valid Event Card.");
  res.json(await nativeEventWorkspace(identity(res), parsed.data.shareToken));
}));
nativeAccountLinkRouter.post("/supporter/event-workspace-save", handle(async (req, res) => {
  const parsed = nativeWorkspaceCommand.safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Check the event tool changes and try again.");
  res.json(await nativeEventWorkspace(identity(res), parsed.data.shareToken, parsed.data, notifyStatTrackerShareUpdate));
}));
nativeAccountLinkRouter.post("/supporter/event-cards", handle(async (req, res) => {
  const parsed = CreateScheduleShareBody.strict().safeParse(req.body);
  if (!parsed.success || parsed.data.purpose !== "game-on-card"
    || parsed.data.calendarProjectId !== undefined || parsed.data.events.length !== 1) {
    throw new NativeLinkError(400, "Enter one valid game or practice Event Card.");
  }
  const event = parsed.data.events[0];
  const parsedDate = event ? new Date(`${event.date}T00:00:00.000Z`) : null;
  const dateIsValid = Boolean(
    parsedDate
    && Number.isFinite(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === event?.date,
  );
  if (!event || (event.type !== "game" && event.type !== "practice")
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id)
    || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)
    || !dateIsValid
    || (event.time !== "" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.time))
    || !event.timezone || !isIanaTimezone(event.timezone)
    || (event.type === "game" && !event.opponent.trim())) {
    throw new NativeLinkError(400, "Check the event date, time, time zone, and opponent.");
  }

  const created = await createNativeSupporterEventCard(identity(res), {
    eventId: event.id,
    type: event.type,
    date: event.date,
    time: event.time,
    timezone: event.timezone!,
    location: event.location,
    opponent: event.opponent,
  });
  try {
    await reconcileGameOnShare(created.share);
  } catch {
    req.log.warn("Native Event Card saved; reminder scheduling needs reconciliation");
  }
  res.status(created.created ? 201 : 200).json({
    shareToken: created.shareToken,
    eventId: created.eventId,
  });
}));
nativeAccountLinkRouter.patch("/supporter/event-cards/:shareToken", handle(async (req, res) => {
  const parsedToken = z.uuid().safeParse(req.params.shareToken);
  const parsed = NativeEventCardEditBody.safeParse(req.body);
  if (!parsedToken.success || !parsed.success
    || !isValidNativeEventDate(parsed.data.date)
    || !isIanaTimezone(parsed.data.timezone)
    || (parsed.data.type === "game" && !parsed.data.opponent.trim())) {
    throw new NativeLinkError(400, "Check the event type, date, time, time zone, and opponent.");
  }

  const updated = await updateNativeSupporterEventCard(
    identity(res),
    parsedToken.data,
    parsed.data,
  );
  try {
    await reconcileGameOnShare(updated.share);
  } catch {
    req.log.warn("Native Event Card updated; reminder scheduling needs reconciliation");
  }
  res.json({ shareToken: updated.shareToken, eventId: updated.eventId });
}));
nativeAccountLinkRouter.get("/supporter/profile", handle(async (_req, res) => {
  res.json(await loadNativeSupporterProfile(identity(res)));
}));
nativeAccountLinkRouter.patch("/supporter/profile", handle(async (req, res) => {
  const parsed = UpdateNativeSupporterProfileBody.strict().safeParse(req.body);
  if (!parsed.success) {
    throw new NativeLinkError(400, "Enter the athlete’s name and check the optional profile details.");
  }
  res.json(await updateNativeSupporterProfile(identity(res), parsed.data));
}));
nativeAccountLinkRouter.get("/supporter/hype-card", handle(async (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate").set("Pragma", "no-cache");
  res.json(GetNativeSupporterHypeCardResponse.parse(await loadNativeSupporterHypeCard(identity(res))));
}));
nativeAccountLinkRouter.patch("/supporter/hype-card", handle(async (req, res) => {
  const parsed = UpdateNativeSupporterHypeCardBody.strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Check the HYPE Card settings and try again.");
  const updated = await updateNativeSupporterHypeCard(identity(res), parsed.data);
  res.json(UpdateNativeSupporterHypeCardResponse.parse(updated));
}));
nativeAccountLinkRouter.post("/supporter/hype-card/identity", handle(async (req, res) => {
  const parsed = CorrectNativeSupporterHypeCardIdentityBody.strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Confirm that this HYPE Card belongs to the selected athlete.");
  const updated = await correctNativeSupporterHypeCardIdentity(identity(res), parsed.data);
  res.json(CorrectNativeSupporterHypeCardIdentityResponse.parse(updated));
}));
const NativeAthletePhotoExpectation = RemoveNativeAthletePhotoBody.strict();
nativeAccountLinkRouter.get("/supporter/hype-card/athlete-photo/readiness", handle(async (_req, res) => {
  const result = await checkPhotoStorageReadiness();
  res.set("Cache-Control", "no-store").status(result.status === "ready" ? 200 : 503)
    .json(result.status === "ready" ? result : { ...result, error: photoStorageUnavailableMessage });
}));
nativeAccountLinkRouter.get("/supporter/hype-card/athlete-photo", handle(async (_req, res) => {
  res.json(GetNativeAthletePhotoStateResponse.parse(await nativeAthletePhoto.state(identity(res))));
}, "state"));
nativeAccountLinkRouter.get("/supporter/hype-card/athlete-photo/image", handle(async (req, res) => {
  const parsed = NativeAthletePhotoExpectation.safeParse({
    cardId: req.get("X-Hype-Card-ID"), revision: req.get("X-Photo-Revision"),
  });
  if (!parsed.success) throw new NativeLinkError(400, "Refresh the athlete photo before viewing it.");
  const contents = await nativeAthletePhoto.image(identity(res), parsed.data);
  if (!contents) { res.status(404).end(); return; }
  res.type("image/webp").send(contents);
}, "image"));
nativeAccountLinkRouter.put("/supporter/hype-card/athlete-photo",
  handle(async (req, res) => {
    await limitNativeLinkAction(JSON.stringify(identity(res)), "athlete-photo", 20);
    // Keep body-parser errors inside the safe photo boundary, too. Do not
    // forward parser errors, which may carry the uploaded bytes, to logging.
    await new Promise<void>((resolve, reject) => {
      raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" })(req, res, (error) => {
        if (error) reject(new NativeLinkError(400, "Choose a valid photo up to 5 MB."));
        else resolve();
      });
    });
    const parsed = NativeAthletePhotoExpectation.safeParse({
      cardId: req.get("X-Hype-Card-ID"), revision: req.get("X-Photo-Revision"),
    });
    if (!parsed.success || !Buffer.isBuffer(req.body) || !req.body.length) {
      throw new NativeLinkError(400, "Choose a valid athlete photo and refresh before trying again.");
    }
    res.json(GetNativeAthletePhotoStateResponse.parse(
      await nativeAthletePhoto.save(identity(res), parsed.data, req.body, req.get("content-type")?.split(";")[0] ?? ""),
    ));
  }, "save"),
);
nativeAccountLinkRouter.delete("/supporter/hype-card/athlete-photo", handle(async (req, res) => {
  const parsed = NativeAthletePhotoExpectation.safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Refresh the athlete photo before removing it.");
  res.json(GetNativeAthletePhotoStateResponse.parse(await nativeAthletePhoto.remove(identity(res), parsed.data)));
}, "remove"));
nativeAccountLinkRouter.get("/supporter/hype-card/photo", handle(async (_req, res) => {
  const photo = await loadNativeSupporterHypeCardPhoto(identity(res), "photo");
  if (!photo) { res.status(404).end(); return; }
  res.type("image/webp").send(photo);
}));
nativeAccountLinkRouter.get("/supporter/hype-card/cutout-photo", handle(async (_req, res) => {
  const photo = await loadNativeSupporterHypeCardPhoto(identity(res), "cutout");
  if (!photo) { res.status(404).end(); return; }
  res.type("image/webp").send(photo);
}));
nativeAccountLinkRouter.post("/link/requests", handle(async (req, res) => {
  const parsed = BeginNativeAccountLinkBody.strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "A valid device challenge is required.");
  const who = identity(res);
  await limitNativeLinkAction(JSON.stringify(who), "begin", 5);
  res.json(await service.start(who, parsed.data.codeChallenge));
}));
for (const action of ["status", "complete", "cancel"] as const) {
  nativeAccountLinkRouter.post(`/link/requests/${action}`, handle(async (req, res) => {
    const parsed = PollNativeAccountLinkBody.strict().safeParse(req.body);
    if (!parsed.success) throw new NativeLinkError(400, "A valid device proof is required.");
    const method = action === "status" ? "poll" : action;
    res.json(await service[method](identity(res), parsed.data.requestId, parsed.data.codeVerifier));
  }));
}
nativeAccountLinkRouter.use((_req, res) => { res.status(404).json({ error: "Unknown native endpoint" }); });

export const webNativeAccountLinkRouter = Router();
const webOriginGuard: RequestHandler = handle((req, _res, next) => {
  const origin = req.get("origin");
  if ((origin && origin !== nativeLinkWebOrigin())
    || (req.method !== "GET" && (!origin || req.get("x-pixl-link-intent") !== "1"))) {
    throw new NativeLinkError(403, "Open this page directly on the PIXL Sports website.");
  }
  next();
});
webNativeAccountLinkRouter.use("/account/native-link", webOriginGuard);
webNativeAccountLinkRouter.get("/account/native-link", requireAuthenticatedIdentity, handle(async (_req, res) => {
  res.json(await service.webCurrent(getRequiredClerkUserId(res)));
}));
webNativeAccountLinkRouter.delete("/account/native-link", requireAuthenticatedIdentity, handle(async (_req, res) => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const result = await service.disconnect(ownerClerkUserId);
  await unregisterNativePushForOwner(ownerClerkUserId);
  res.json(result);
}));
webNativeAccountLinkRouter.post("/account/native-link/preview", requireAuth, handle(async (req, res) => {
  nativeIssuer(); // Missing native configuration fails explicitly on the web too.
  const parsed = PreviewWebNativeAccountLinkBody.strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Enter the eight-character code shown on your iPhone.");
  const owner = getRequiredClerkUserId(res);
  await limitNativeLinkAction(owner, "web-code", 20);
  res.json(await service.preview(owner, parsed.data.userCode));
}));
webNativeAccountLinkRouter.post("/account/native-link/decision", requireAuth, handle(async (req, res) => {
  nativeIssuer();
  const parsed = DecideWebNativeAccountLinkBody.strict().safeParse(req.body);
  if (!parsed.success) throw new NativeLinkError(400, "Review the code before making a decision.");
  const owner = getRequiredClerkUserId(res);
  await limitNativeLinkAction(owner, "web-decision", 20);
  const { requestId, userCode, decision } = parsed.data;
  let label = `PIXL account …${owner.slice(-6)}`;
  if (decision === "approve") {
    const user = await createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }).users.getUser(owner);
    const email = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId)?.emailAddress;
    const maskedEmail = email?.replace(/^(.{1,2})[^@]*@/, "$1…@");
    label = [user.firstName, maskedEmail].filter(Boolean).join(" · ") || label;
  }
  res.json(await service.decide(owner, requestId, userCode, decision, label));
}));
