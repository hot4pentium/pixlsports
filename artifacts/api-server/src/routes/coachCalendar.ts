import { randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ConnectToCoachCalendarBody,
  ConnectToCoachCalendarResponse,
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

const router: IRouter = Router();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode() {
  return Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
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
    res.json(GetCoachCalendarCodeResponse.parse({ code: code.code }));
  } catch (error) {
    res.status(500).json({ error: "Unable to create coach calendar code" });
  }
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