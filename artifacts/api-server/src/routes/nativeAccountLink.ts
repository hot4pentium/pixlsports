import { createClerkClient } from "@clerk/express";
import { Router, type RequestHandler } from "express";
import {
  BeginNativeAccountLinkBody, PollNativeAccountLinkBody,
  PreviewWebNativeAccountLinkBody, DecideWebNativeAccountLinkBody,
  CreateScheduleShareBody,
} from "@workspace/api-zod";
import { nativeAccountLinkService as service, limitNativeLinkAction } from "../lib/nativeAccountLink";
import { NativeLinkError, nativeIssuer, nativeLinkWebOrigin, verifyNativeIdentity, type NativeIdentity } from "../lib/nativeIdentity";
import { createNativeSupporterEventCard, loadNativeSupporterSchedule } from "../lib/nativeSupporterSchedule";
import { loadNativeSupporterHypeCard } from "../lib/nativeSupporterHypeCard";
import { getRequiredClerkUserId, requireAuth, requireAuthenticatedIdentity } from "../middlewares/requireAuth";
import { isIanaTimezone } from "../lib/timezone";
import { reconcileGameOnShare } from "../jobs/gameOnReminderQueue";

const handle: (fn: RequestHandler) => RequestHandler = (fn) => async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try { await fn(req, res, next); } catch (error) {
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
  next();
}));
const identity = (res: { locals: Record<string, unknown> }) => res.locals.nativeIdentity as NativeIdentity;
nativeAccountLinkRouter.get("/link", handle(async (_req, res) => {
  res.json(await service.current(identity(res)));
}));
nativeAccountLinkRouter.delete("/link", handle(async (_req, res) => {
  res.json(await service.disconnect(identity(res)));
}));
nativeAccountLinkRouter.get("/supporter/schedule", handle(async (_req, res) => {
  res.json(await loadNativeSupporterSchedule(identity(res)));
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
nativeAccountLinkRouter.get("/supporter/hype-card", handle(async (_req, res) => {
  res.json(await loadNativeSupporterHypeCard(identity(res)));
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
  res.json(await service.disconnect(getRequiredClerkUserId(res)));
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
