import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateProjectBody,
  GetProjectParams,
  ListProjectsResponse,
  UpdateProjectBody,
  UpdateProjectParams,
} from "@workspace/api-zod";
import { cloudProjectsTable, db, projectMediaTable, projectMediaUploadClaimsTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth, requireProjectEditorAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { consumeGuestUsageBatch, getAccountAccessSnapshot } from "./accountAccess";
import { hasActivePaidEntitlement } from "../lib/accountLifecycle";
import { creditSoccerTrackerGames } from "../lib/soccerGear";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_PROJECTS_PER_USER = 100;

type ProjectRow = typeof cloudProjectsTable.$inferSelect;

function withoutMedia(project: unknown, preserveFraming = false): unknown {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return project;
  }

  const source = project as Record<string, unknown>;
  const cleaned = {
    ...project,
    mediaType: null,
    mediaId: null,
    videoMeta: preserveFraming ? source.videoMeta : null,
    photo: null,
    logo: null,
  };
  return cleaned;
}

async function mediaForProject(projectId: string, ownerClerkUserId: string) {
  return db
    .select({
      id: projectMediaTable.id,
      objectPath: projectMediaTable.objectPath,
      name: projectMediaTable.name,
      contentType: projectMediaTable.contentType,
      size: projectMediaTable.size,
      mediaType: projectMediaTable.mediaType,
      mediaRole: projectMediaTable.mediaRole,
      createdAt: projectMediaTable.createdAt,
    })
    .from(projectMediaTable)
    .where(
      and(
        eq(projectMediaTable.projectId, projectId),
        eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
      ),
    )
    .orderBy(asc(projectMediaTable.createdAt));
}

async function projectResponse(project: ProjectRow, ownerClerkUserId: string) {
  const media = await mediaForProject(project.id, ownerClerkUserId);
  return {
    id: project.id,
    name: project.name,
    project: project.project,
    revision: project.revision,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    media,
  };
}

router.get("/projects", requireProjectEditorAuth, async (req, res): Promise<void> => {
  const athleteEditorAccess = res.locals.athleteEditorAccess as { ownerClerkUserId: string; projectId: string } | undefined;
  const ownerClerkUserId = athleteEditorAccess?.ownerClerkUserId ?? getRequiredClerkUserId(res);
  const conditions = [eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId)];
  if (athleteEditorAccess) conditions.push(eq(cloudProjectsTable.id, athleteEditorAccess.projectId));
  const projects = await db
    .select()
    .from(cloudProjectsTable)
    .where(and(...conditions))
    .orderBy(asc(cloudProjectsTable.updatedAt));
  const scopedProjects = athleteEditorAccess
    ? projects.filter((project) => {
        const value = project.project as { tool?: unknown } | null;
        return value?.tool === "hype-card";
      })
    : projects;
  const response = await Promise.all(
    scopedProjects.map((project) => projectResponse(project, ownerClerkUserId)),
  );
  res.json(ListProjectsResponse.parse(response));
});

router.post("/projects", requireAuth, async (req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid project create request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const projectPayload = parsed.data.project as { tool?: unknown } | null;
  if (projectPayload && typeof projectPayload === "object" && projectPayload.tool === "schedule") {
    res.status(410).json({ error: "Standalone Calendar projects are no longer supported." });
    return;
  }

  const [{ value: projectCount }] = await db
    .select({ value: count() })
    .from(cloudProjectsTable)
    .where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId));
  if (Number(projectCount) >= MAX_PROJECTS_PER_USER) {
    res.status(409).json({ error: "Project limit reached" });
    return;
  }

  const accountAccess = await getAccountAccessSnapshot(ownerClerkUserId);
  const paid = await hasActivePaidEntitlement(ownerClerkUserId);
  if (accountAccess.accessMode === "guest") {
    const project = parsed.data.project as { tool?: unknown; events?: unknown } | null;
    const tool = project && typeof project === "object" && typeof project.tool === "string"
      ? project.tool
      : "";
    const usageCategory = tool === "hype-card"
      ? "hype_card"
      : tool === "schedule"
        ? "schedule_event"
        : tool === "stat-tracker"
          ? "lineup"
          : null;
    if (!usageCategory) {
      res.status(400).json({ error: "Unknown project tool" });
      return;
    }
    const usageKeys = usageCategory === "schedule_event" && Array.isArray(project?.events)
      ? project.events
        .map((event) => (
          typeof event === "object" && event !== null && typeof (event as { id?: unknown }).id === "string"
            ? `schedule-event:${(event as { id: string }).id}`
            : null
        ))
        .filter((key): key is string => Boolean(key))
      : parsed.data.guestUsageKey
        ? [`${usageCategory}:${parsed.data.guestUsageKey}`]
        : [`${usageCategory}:project:${Date.now()}`];
    const usageResult = await consumeGuestUsageBatch(ownerClerkUserId, usageCategory, usageKeys);
    if (!usageResult.allowed) {
      res.status(409).json({
        error: "Workspace allowance reached. Use existing work or contact support.",
      });
      return;
    }
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(cloudProjectsTable)
        .values({
          ownerClerkUserId,
          name: parsed.data.name,
          project: withoutMedia(parsed.data.project, paid),
        })
        .returning();
      await creditSoccerTrackerGames(tx, ownerClerkUserId, project.project);
      return project;
    });
    res.status(201).json(await projectResponse(created, ownerClerkUserId));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create cloud project");
    res.status(500).json({ error: "Unable to create cloud project" });
  }
});

router.get("/projects/:projectId", requireProjectEditorAuth, async (req, res): Promise<void> => {
  const athleteEditorAccess = res.locals.athleteEditorAccess as { ownerClerkUserId: string; projectId: string } | undefined;
  const ownerClerkUserId = athleteEditorAccess?.ownerClerkUserId ?? getRequiredClerkUserId(res);
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(cloudProjectsTable)
    .where(
      and(
        eq(cloudProjectsTable.id, params.data.projectId),
        eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
        ...(athleteEditorAccess ? [eq(cloudProjectsTable.id, athleteEditorAccess.projectId)] : []),
      ),
    );
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const projectData = project.project as { tool?: unknown } | null;
  if (athleteEditorAccess && projectData?.tool !== "hype-card") {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(await projectResponse(project, ownerClerkUserId));
});

router.patch("/projects/:projectId", requireProjectEditorAuth, async (req, res): Promise<void> => {
  const athleteEditorAccess = res.locals.athleteEditorAccess as { ownerClerkUserId: string; projectId: string } | undefined;
  const ownerClerkUserId = athleteEditorAccess?.ownerClerkUserId ?? getRequiredClerkUserId(res);
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid project update request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.name === undefined && parsed.data.project === undefined) {
    res.status(400).json({ error: "At least one project field must be updated" });
    return;
  }

  const [current] = await db
    .select()
    .from(cloudProjectsTable)
    .where(
      and(
        eq(cloudProjectsTable.id, params.data.projectId),
        eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
        ...(athleteEditorAccess ? [eq(cloudProjectsTable.id, athleteEditorAccess.projectId)] : []),
      ),
    );
  if (!current) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const currentPayload = current.project as { tool?: unknown } | null;
  const incomingPayload = parsed.data.project as { tool?: unknown } | null | undefined;
  if (athleteEditorAccess
    && (currentPayload?.tool !== "hype-card"
      || (incomingPayload !== undefined && incomingPayload?.tool !== "hype-card"))) {
    res.status(403).json({ error: "Athlete access is limited to the linked HYPE Card." });
    return;
  }
  if ((currentPayload && typeof currentPayload === "object" && currentPayload.tool === "schedule")
    || (incomingPayload && typeof incomingPayload === "object" && incomingPayload.tool === "schedule")) {
    res.status(410).json({ error: "Standalone Calendar projects are no longer supported." });
    return;
  }
  if (current.revision !== parsed.data.expectedRevision) {
    res.status(409).json({
      error: "Project revision is stale",
      current: await projectResponse(current, ownerClerkUserId),
    });
    return;
  }

  const updates: {
    name?: string;
    project?: unknown;
    revision: SQL<unknown>;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
    revision: sql`${cloudProjectsTable.revision} + 1`,
  };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.project !== undefined) {
    updates.project = withoutMedia(parsed.data.project, await hasActivePaidEntitlement(ownerClerkUserId));
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [project] = await tx
        .update(cloudProjectsTable)
        .set(updates)
        .where(
          and(
            eq(cloudProjectsTable.id, params.data.projectId),
            eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
            eq(cloudProjectsTable.revision, parsed.data.expectedRevision),
          ),
        )
        .returning();
      if (project) await creditSoccerTrackerGames(tx, ownerClerkUserId, project.project);
      return project;
    });

    if (!updated) {
      const [latest] = await db
        .select()
        .from(cloudProjectsTable)
        .where(
          and(
            eq(cloudProjectsTable.id, params.data.projectId),
            eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
          ),
        );
      if (!latest) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      res.status(409).json({
        error: "Project revision is stale",
        current: await projectResponse(latest, ownerClerkUserId),
      });
      return;
    }

    res.json(await projectResponse(updated, ownerClerkUserId));
  } catch (error) {
    req.log.error({ err: error }, "Unable to update cloud project");
    res.status(500).json({ error: "Unable to update cloud project" });
  }
});

router.delete("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const media = await db
    .select()
    .from(projectMediaTable)
    .where(
      and(
        eq(projectMediaTable.projectId, params.data.projectId),
        eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
      ),
    );
  const claims = await db.select({ objectPath: projectMediaUploadClaimsTable.objectPath }).from(projectMediaUploadClaimsTable).where(and(
    eq(projectMediaUploadClaimsTable.projectId, params.data.projectId),
    eq(projectMediaUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
  ));
  const claimPaths = claims.map((claim) => claim.objectPath);
  const deletableObjectPaths: string[] = [];
  for (const item of media) {
    const [otherReference] = await db
      .select({ id: projectMediaTable.id })
      .from(projectMediaTable)
      .where(
        and(
          eq(projectMediaTable.objectPath, item.objectPath),
          eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
          sql`${projectMediaTable.projectId} IS DISTINCT FROM ${params.data.projectId}`,
        ),
      );
    if (!otherReference) {
      deletableObjectPaths.push(item.objectPath);
    }
  }
  const [deleted] = await db
    .delete(cloudProjectsTable)
    .where(
      and(
        eq(cloudProjectsTable.id, params.data.projectId),
        eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
      ),
    )
    .returning({ id: cloudProjectsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  for (const objectPath of deletableObjectPaths) {
    try {
      await objectStorageService.deleteObjectEntity(objectPath);
    } catch (error) {
      req.log.warn({ err: error, objectPath }, "Unable to remove project media object");
    }
  }
  for (const objectPath of claimPaths) {
    try { await objectStorageService.deleteObjectEntity(objectPath); } catch (error) {
      req.log.warn({ err: error, objectPath }, "Unable to remove expired project media claim object");
    }
  }
  await db.delete(projectMediaUploadClaimsTable).where(and(
    eq(projectMediaUploadClaimsTable.projectId, params.data.projectId),
    eq(projectMediaUploadClaimsTable.ownerClerkUserId, ownerClerkUserId),
  ));
  res.sendStatus(204);
});

export default router;