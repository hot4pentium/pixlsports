import { randomBytes } from "crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAthleteInviteBody,
  CreateAthleteInviteResponse,
  DeleteAthleteInviteParams,
  GetAthleteInviteParams,
  GetAthleteInviteResponse,
  ListAthleteInvitesResponse,
  UpdateAthleteInviteBody,
  UpdateAthleteInviteParams,
  UpdateAthleteInviteResponse,
} from "@workspace/api-zod";
import {
  athleteInvitesTable,
  cloudProjectsTable,
  db,
  hypeCardSharesTable,
} from "@workspace/db";

import { isAccountActive } from "../lib/accountLifecycle";
import { computeHypeCardShareStats, isHypeCardSport } from "../lib/hypeCardShareStats";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

type InviteRow = typeof athleteInvitesTable.$inferSelect;

function ownedInviteResponse(invite: InviteRow) {
  return {
    inviteToken: invite.publicToken,
    athleteName: invite.athleteName,
    teamName: invite.teamName,
    seasonName: invite.seasonName,
    seasonEndsAt: invite.seasonEndsAt,
    sport: invite.sport,
    trackerProjectId: invite.trackerProjectId,
    scheduleProjectId: invite.scheduleProjectId,
    showHypeCard: invite.showHypeCard,
    showStats: invite.showStats,
    showSchedule: invite.showSchedule,
    createdAt: invite.createdAt,
    updatedAt: invite.updatedAt,
  };
}

async function validateProject(
  projectId: string | null,
  ownerClerkUserId: string,
  expectedTool: "stat-tracker" | "schedule",
) {
  if (!projectId) return null;
  const [project] = await db
    .select()
    .from(cloudProjectsTable)
    .where(and(
      eq(cloudProjectsTable.id, projectId),
      eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
    ));
  const tool = project?.project && typeof project.project === "object"
    ? (project.project as { tool?: unknown }).tool
    : null;
  return project && tool === expectedTool ? project : null;
}

async function validateSources(
  ownerClerkUserId: string,
  input: { trackerProjectId: string | null; scheduleProjectId: string | null },
) {
  const [tracker, schedule] = await Promise.all([
    validateProject(input.trackerProjectId, ownerClerkUserId, "stat-tracker"),
    validateProject(input.scheduleProjectId, ownerClerkUserId, "schedule"),
  ]);
  return {
    valid: (!input.trackerProjectId || Boolean(tracker))
      && (!input.scheduleProjectId || Boolean(schedule)),
    tracker,
    schedule,
  };
}

function cleanScheduleEvents(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const source = payload as { tool?: unknown; events?: unknown };
  if (source.tool !== "schedule" || !Array.isArray(source.events)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return source.events.flatMap((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const item = event as Record<string, unknown>;
    const type = item.type === "practice" || item.type === "meeting" ? item.type : "game";
    const status = item.status === "live" || item.status === "final" ? item.status : "upcoming";
    const date = typeof item.date === "string" ? item.date.slice(0, 30) : "";
    if (!date || date < today || status === "final") return [];
    return [{
      id: typeof item.id === "string" ? item.id.slice(0, 100) : `${type}-${date}`,
      type,
      status,
      date,
      time: typeof item.time === "string" ? item.time.slice(0, 30) : "",
      location: typeof item.location === "string" ? item.location.slice(0, 300) : "",
      opponent: type === "game" && typeof item.opponent === "string" ? item.opponent.slice(0, 200) : "",
      notes: typeof item.notes === "string" ? item.notes.slice(0, 1000) : "",
    }];
  }).sort((left, right) => (
    `${left.date}T${left.time || "23:59"}`.localeCompare(`${right.date}T${right.time || "23:59"}`)
  )).slice(0, 12);
}

router.get("/athlete-invites", requireAuth, async (_req, res): Promise<void> => {
  const invites = await db
    .select()
    .from(athleteInvitesTable)
    .where(eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)))
    .orderBy(desc(athleteInvitesTable.createdAt));
  res.json(ListAthleteInvitesResponse.parse(invites.map(ownedInviteResponse)));
});

router.post("/athlete-invites", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateAthleteInviteBody.safeParse(req.body);
  if (!parsed.success || parsed.data.seasonEndsAt.getTime() <= Date.now()) {
    res.status(400).json({ error: "Choose an athlete, season, and future season end date." });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const sources = await validateSources(ownerClerkUserId, parsed.data);
  if (!sources.valid) {
    res.status(400).json({ error: "Choose tracker and schedule projects owned by this account." });
    return;
  }
  try {
    const [created] = await db.insert(athleteInvitesTable).values({
      ...parsed.data,
      athleteName: parsed.data.athleteName.trim(),
      teamName: parsed.data.teamName.trim(),
      seasonName: parsed.data.seasonName.trim(),
      ownerClerkUserId,
      publicToken: randomBytes(24).toString("base64url"),
    }).returning();
    res.status(201).json(CreateAthleteInviteResponse.parse(ownedInviteResponse(created)));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "This account already has an athlete invite. Update or revoke it first." });
      return;
    }
    req.log.error({ err: error }, "Unable to create athlete invite");
    res.status(500).json({ error: "Unable to create athlete invite" });
  }
});

router.get("/athlete-invites/:inviteToken", async (req, res): Promise<void> => {
  const params = GetAthleteInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  const [invite] = await db.select().from(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    gt(athleteInvitesTable.seasonEndsAt, new Date()),
  ));
  if (!invite || !(await isAccountActive(invite.ownerClerkUserId))) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }

  const [trackerProject, scheduleProject, latestHypeCard] = await Promise.all([
    invite.showStats && invite.trackerProjectId
      ? validateProject(invite.trackerProjectId, invite.ownerClerkUserId, "stat-tracker")
      : null,
    invite.showSchedule && invite.scheduleProjectId
      ? validateProject(invite.scheduleProjectId, invite.ownerClerkUserId, "schedule")
      : null,
    invite.showHypeCard
      ? db.select().from(hypeCardSharesTable).where(and(
        eq(hypeCardSharesTable.ownerClerkUserId, invite.ownerClerkUserId),
        eq(hypeCardSharesTable.shareMode, "card"),
        isNull(hypeCardSharesTable.revokedAt),
        gt(hypeCardSharesTable.expiresAt, new Date()),
      )).orderBy(desc(hypeCardSharesTable.createdAt)).limit(1).then(([share]) => share ?? null)
      : null,
  ]);
  const stats = trackerProject && isHypeCardSport(invite.sport)
    ? computeHypeCardShareStats(
      trackerProject.project,
      invite.athleteName,
      invite.sport,
      trackerProject.updatedAt,
    )
    : null;
  const scheduleEvents = scheduleProject ? cleanScheduleEvents(scheduleProject.project) : [];
  const updatedAt = new Date(Math.max(
    invite.updatedAt.getTime(),
    trackerProject?.updatedAt.getTime() ?? 0,
    scheduleProject?.updatedAt.getTime() ?? 0,
    latestHypeCard?.createdAt.getTime() ?? 0,
  ));

  res.json(GetAthleteInviteResponse.parse({
    inviteToken: invite.publicToken,
    athleteName: invite.athleteName,
    teamName: invite.teamName,
    seasonName: invite.seasonName,
    seasonEndsAt: invite.seasonEndsAt,
    sport: invite.sport,
    hypeCard: latestHypeCard ? {
      shareToken: latestHypeCard.publicToken,
      title: latestHypeCard.title,
      mediaType: latestHypeCard.mediaType,
      posterUrl: `/api/hype-card-shares/${latestHypeCard.publicToken}/media/poster`,
      createdAt: latestHypeCard.createdAt,
    } : null,
    stats,
    scheduleEvents,
    updatedAt,
  }));
});

router.patch("/athlete-invites/:inviteToken", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAthleteInviteParams.safeParse(req.params);
  const parsed = UpdateAthleteInviteBody.safeParse(req.body);
  if (!params.success || !parsed.success || parsed.data.seasonEndsAt.getTime() <= Date.now()) {
    res.status(400).json({ error: "Choose an athlete, season, and future season end date." });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const sources = await validateSources(ownerClerkUserId, parsed.data);
  if (!sources.valid) {
    res.status(400).json({ error: "Choose tracker and schedule projects owned by this account." });
    return;
  }
  const [updated] = await db.update(athleteInvitesTable).set({
    ...parsed.data,
    athleteName: parsed.data.athleteName.trim(),
    teamName: parsed.data.teamName.trim(),
    seasonName: parsed.data.seasonName.trim(),
    updatedAt: new Date(),
  }).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
  )).returning();
  if (!updated) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  res.json(UpdateAthleteInviteResponse.parse(ownedInviteResponse(updated)));
});

router.delete("/athlete-invites/:inviteToken", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteAthleteInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  const [deleted] = await db.delete(athleteInvitesTable).where(and(
    eq(athleteInvitesTable.publicToken, params.data.inviteToken),
    eq(athleteInvitesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
  )).returning({ id: athleteInvitesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Athlete invite not found" });
    return;
  }
  res.status(204).send();
});

export default router;