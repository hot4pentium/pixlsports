import { randomBytes, randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ConnectToCoachCalendarBody,
  ConnectToCoachCalendarResponse,
  CreateCoachCalendarSubscriptionResponse,
  GetCoachCalendarCodeResponse,
  GetConnectedCoachCalendarParams,
  GetConnectedCoachCalendarResponse,
  type ScheduleEvent,
} from "@workspace/api-zod";
import {
  cloudProjectsTable,
  coachCalendarCodesTable,
  db,
  scheduleSharesTable,
} from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isAccountActive } from "../lib/accountLifecycle";
import { buildCoachCalendarIcs } from "../lib/coachCalendarIcs";

const router: IRouter = Router();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SUBSCRIPTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,100}$/;

function createCode() {
  return Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

function createSubscriptionToken() {
  return randomBytes(32).toString("base64url");
}

function subscriptionFeedPath(token: string) {
  return `/api/coach-calendar/feed/${token}.ics`;
}

export async function createCoachCalendarSubscriptionForOwner(ownerClerkUserId: string) {
  await getOrCreateCode(ownerClerkUserId);
  const token = createSubscriptionToken();
  const [subscription] = await db
    .update(coachCalendarCodesTable)
    .set({
      subscriptionToken: token,
      subscriptionRevokedAt: null,
    })
    .where(eq(coachCalendarCodesTable.ownerClerkUserId, ownerClerkUserId))
    .returning();
  if (!subscription) throw new Error("Unable to create calendar subscription");
  return { token, feedPath: subscriptionFeedPath(token) };
}

export async function revokeCoachCalendarSubscriptionForOwner(ownerClerkUserId: string) {
  await db
    .update(coachCalendarCodesTable)
    .set({ subscriptionRevokedAt: new Date() })
    .where(eq(coachCalendarCodesTable.ownerClerkUserId, ownerClerkUserId));
}

export async function findActiveCoachCalendarSubscription(token: string) {
  if (!SUBSCRIPTION_TOKEN_PATTERN.test(token)) return null;
  const [subscription] = await db
    .select()
    .from(coachCalendarCodesTable)
    .where(eq(coachCalendarCodesTable.subscriptionToken, token))
    .limit(1);
  if (
    !subscription
    || subscription.subscriptionRevokedAt
    || !(await isAccountActive(subscription.ownerClerkUserId))
  ) {
    return null;
  }
  return subscription;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeEvents(value: unknown): ScheduleEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((event): event is Record<string, unknown> => typeof event === "object" && event !== null)
    .map((event, index) => {
      const type: ScheduleEvent["type"] = event.type === "practice" || event.type === "meeting" ? event.type : "game";
      return {
        id: asString(event.id) || `schedule-event-${index + 1}`,
        type,
        date: asString(event.date),
        time: asString(event.time),
        location: asString(event.location),
        opponent: type === "game" ? asString(event.opponent) : "",
        snacks: asString(event.snacks),
        drinks: asString(event.drinks),
        notes: asString(event.notes),
      };
    })
    .slice(0, 50);
}

async function getOrCreateCode(ownerClerkUserId: string) {
  const [existing] = await db
    .select()
    .from(coachCalendarCodesTable)
    .where(eq(coachCalendarCodesTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await db
        .insert(coachCalendarCodesTable)
        .values({ ownerClerkUserId, code: createCode() })
        .returning();
      if (created) return created;
    } catch {
      // A rare code collision can safely retry. The owner uniqueness constraint
      // is handled by re-reading below.
      const [ownerCode] = await db
        .select()
        .from(coachCalendarCodesTable)
        .where(eq(coachCalendarCodesTable.ownerClerkUserId, ownerClerkUserId))
        .limit(1);
      if (ownerCode) return ownerCode;
    }
  }

  throw new Error("Unable to generate a coach calendar code");
}

async function findSchedule(ownerClerkUserId: string) {
  const [sharedSchedule] = await db
    .select()
    .from(scheduleSharesTable)
    .where(eq(scheduleSharesTable.ownerClerkUserId, ownerClerkUserId))
    .orderBy(desc(scheduleSharesTable.createdAt))
    .limit(1);

  const projects = await db
    .select()
    .from(cloudProjectsTable)
    .where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId))
    .orderBy(desc(cloudProjectsTable.updatedAt))
    .limit(100);
  const scheduleProject = projects.find((project) => (
    typeof project.project === "object"
    && project.project !== null
    && !Array.isArray(project.project)
    && (project.project as { tool?: unknown }).tool === "schedule"
  ));

  const cloudSchedule = scheduleProject && typeof scheduleProject.project === "object" && scheduleProject.project !== null
    ? (() => {
      const project = scheduleProject.project as Record<string, unknown>;
      return {
        title: asString(project.teamName) || scheduleProject.name,
        teamSeason: asString(project.season),
        events: normalizeEvents(project.events),
        updatedAt: scheduleProject.updatedAt,
      };
    })()
    : null;
  const shared = sharedSchedule
    ? {
      title: sharedSchedule.title,
      teamSeason: sharedSchedule.teamSeason,
      events: normalizeEvents(sharedSchedule.events),
      updatedAt: sharedSchedule.updatedAt,
    }
    : null;

  if (!cloudSchedule) return shared;
  if (!shared) return cloudSchedule;
  return cloudSchedule.updatedAt >= shared.updatedAt ? cloudSchedule : shared;
}

async function calendarResponse(code: string, ownerClerkUserId: string) {
  const schedule = await findSchedule(ownerClerkUserId);
  return {
    code,
    title: schedule?.title ?? "",
    teamSeason: schedule?.teamSeason ?? "",
    events: schedule?.events ?? [],
    scheduleAvailable: Boolean(schedule),
    updatedAt: schedule?.updatedAt ?? null,
  };
}

router.get("/coach-calendar", requireAuth, async (_req, res): Promise<void> => {
  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const code = await getOrCreateCode(ownerClerkUserId);
    res.json(GetCoachCalendarCodeResponse.parse({
      code: code.code,
      subscriptionFeedPath: code.subscriptionToken && !code.subscriptionRevokedAt
        ? subscriptionFeedPath(code.subscriptionToken)
        : null,
    }));
  } catch (error) {
    res.status(500).json({ error: "Unable to create coach calendar code" });
  }
});

router.post("/coach-calendar/subscription", requireAuth, async (_req, res): Promise<void> => {
  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    const subscription = await createCoachCalendarSubscriptionForOwner(ownerClerkUserId);
    res.json(CreateCoachCalendarSubscriptionResponse.parse({
      feedPath: subscription.feedPath,
    }));
  } catch {
    res.status(500).json({ error: "Unable to create calendar subscription" });
  }
});

router.delete("/coach-calendar/subscription", requireAuth, async (_req, res): Promise<void> => {
  try {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    await revokeCoachCalendarSubscriptionForOwner(ownerClerkUserId);
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Unable to revoke calendar subscription" });
  }
});

router.get("/coach-calendar/subscription/:token", requireAuth, async (req, res): Promise<void> => {
  const token = typeof req.params.token === "string" ? req.params.token : "";
  const subscription = await findActiveCoachCalendarSubscription(token);
  if (!subscription) {
    res.status(404).json({ error: "Calendar subscription not found" });
    return;
  }

  const response = await calendarResponse(subscription.code, subscription.ownerClerkUserId);
  res.json(ConnectToCoachCalendarResponse.parse(response));
});

router.post("/coach-calendar/connect", requireAuth, async (req, res): Promise<void> => {
  const parsed = ConnectToCoachCalendarBody.safeParse({
    ...req.body,
    code: typeof req.body?.code === "string" ? req.body.code.toUpperCase() : req.body?.code,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid five-character coach code" });
    return;
  }

  const [code] = await db
    .select()
    .from(coachCalendarCodesTable)
    .where(eq(coachCalendarCodesTable.code, parsed.data.code.toUpperCase()))
    .limit(1);
  if (!code) {
    res.status(404).json({ error: "Coach code not found" });
    return;
  }
  if (!(await isAccountActive(code.ownerClerkUserId))) {
    res.status(404).json({ error: "Coach code not found" });
    return;
  }

  const response = await calendarResponse(code.code, code.ownerClerkUserId);
  res.json(ConnectToCoachCalendarResponse.parse(response));
});

router.get("/coach-calendar/feed/:token", async (req, res): Promise<void> => {
  const rawToken = typeof req.params.token === "string" ? req.params.token : "";
  const token = rawToken.endsWith(".ics") ? rawToken.slice(0, -4) : rawToken;
  if (!SUBSCRIPTION_TOKEN_PATTERN.test(token)) {
    res.status(404).json({ error: "Calendar subscription not found" });
    return;
  }

  const subscription = await findActiveCoachCalendarSubscription(token);
  if (!subscription) {
    res.status(404).json({ error: "Calendar subscription not found" });
    return;
  }

  const schedule = await findSchedule(subscription.ownerClerkUserId);
  const body = buildCoachCalendarIcs(subscription.ownerClerkUserId, schedule);
  res.set({
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Disposition": 'inline; filename="pixl-sports-schedule.ics"',
    "Content-Type": "text/calendar; charset=utf-8",
  });
  res.status(200).send(body);
});

router.get("/coach-calendar/:code", requireAuth, async (req, res): Promise<void> => {
  const parsed = GetConnectedCoachCalendarParams.safeParse({
    code: typeof req.params.code === "string" ? req.params.code.toUpperCase() : req.params.code,
  });
  if (!parsed.success) {
    res.status(404).json({ error: "Coach code not found" });
    return;
  }

  const [code] = await db
    .select()
    .from(coachCalendarCodesTable)
    .where(eq(coachCalendarCodesTable.code, parsed.data.code))
    .limit(1);
  if (!code) {
    res.status(404).json({ error: "Coach code not found" });
    return;
  }
  if (!(await isAccountActive(code.ownerClerkUserId))) {
    res.status(404).json({ error: "Coach code not found" });
    return;
  }

  const response = await calendarResponse(code.code, code.ownerClerkUserId);
  res.json(GetConnectedCoachCalendarResponse.parse(response));
});

export default router;