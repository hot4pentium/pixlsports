import { and, asc, count, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateProjectBody,
  GetProjectParams,
  ListProjectsResponse,
  UpdateProjectBody,
  UpdateProjectParams,
} from "@workspace/api-zod";
import { cloudProjectsTable, db, projectMediaTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  ProjectMediaValidationError,
  validateProjectMediaClaim,
} from "../lib/projectMediaValidation";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_PROJECTS_PER_USER = 100;

type ProjectRow = typeof cloudProjectsTable.$inferSelect;

async function mediaForProject(projectId: string, ownerClerkUserId: string) {
  return db
    .select({
      id: projectMediaTable.id,
      objectPath: projectMediaTable.objectPath,
      name: projectMediaTable.name,
      contentType: projectMediaTable.contentType,
      size: projectMediaTable.size,
      mediaType: projectMediaTable.mediaType,
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

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const projects = await db
    .select()
    .from(cloudProjectsTable)
    .where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId))
    .orderBy(asc(cloudProjectsTable.updatedAt));
  const response = await Promise.all(
    projects.map((project) => projectResponse(project, ownerClerkUserId)),
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

  const [{ value: projectCount }] = await db
    .select({ value: count() })
    .from(cloudProjectsTable)
    .where(eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId));
  if (Number(projectCount) >= MAX_PROJECTS_PER_USER) {
    res.status(409).json({ error: "Project limit reached" });
    return;
  }

  const mediaId = parsed.data.project.mediaId;
  if (mediaId !== null) {
    try {
      await validateProjectMediaClaim({
        mediaId,
        ownerClerkUserId,
        objectStorageService,
      });
    } catch (error) {
      if (error instanceof ProjectMediaValidationError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Unable to validate project media");
      res.status(500).json({ error: "Unable to validate project media" });
      return;
    }
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(cloudProjectsTable)
        .values({
          ownerClerkUserId,
          name: parsed.data.name,
          project: parsed.data.project,
        })
        .returning();

      if (mediaId !== null) {
        const [claimed] = await tx
          .update(projectMediaTable)
          .set({ projectId: inserted.id })
          .where(
            and(
              eq(projectMediaTable.id, mediaId),
              eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
              isNull(projectMediaTable.projectId),
            ),
          )
          .returning({ id: projectMediaTable.id });
        if (!claimed) {
          throw new ProjectMediaValidationError(
            "Project media was claimed by another project",
            409,
          );
        }
      }
      return inserted;
    });
    res.status(201).json(await projectResponse(created, ownerClerkUserId));
  } catch (error) {
    if (error instanceof ProjectMediaValidationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to create cloud project");
    res.status(500).json({ error: "Unable to create cloud project" });
  }
});

router.get("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
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
      ),
    );
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(await projectResponse(project, ownerClerkUserId));
});

router.patch("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
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
      ),
    );
  if (!current) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (current.revision !== parsed.data.expectedRevision) {
    res.status(409).json({
      error: "Project revision is stale",
      current: await projectResponse(current, ownerClerkUserId),
    });
    return;
  }

  const mediaId = parsed.data.project?.mediaId;
  if (mediaId !== undefined && mediaId !== null) {
    try {
      await validateProjectMediaClaim({
        mediaId,
        ownerClerkUserId,
        projectId: current.id,
        objectStorageService,
      });
    } catch (error) {
      if (error instanceof ProjectMediaValidationError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Unable to validate project media");
      res.status(500).json({ error: "Unable to validate project media" });
      return;
    }
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
  if (parsed.data.project !== undefined) updates.project = parsed.data.project;

  try {
    const updated = await db.transaction(async (tx) => {
      const [changed] = await tx
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
      if (!changed) return undefined;

      if (mediaId !== undefined && mediaId !== null) {
        const [claimed] = await tx
          .update(projectMediaTable)
          .set({ projectId: changed.id })
          .where(
            and(
              eq(projectMediaTable.id, mediaId),
              eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId),
              or(
                isNull(projectMediaTable.projectId),
                eq(projectMediaTable.projectId, changed.id),
              ),
            ),
          )
          .returning({ id: projectMediaTable.id });
        if (!claimed) {
          throw new ProjectMediaValidationError(
            "Project media was claimed by another project",
            409,
          );
        }
      }
      return changed;
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
    if (error instanceof ProjectMediaValidationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
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
  res.sendStatus(204);
});

export default router;