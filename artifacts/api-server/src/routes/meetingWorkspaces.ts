import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  DeleteMeetingWorkspaceParams,
  GetMeetingRecapParams,
  GetMeetingRecapResponse,
  GetMeetingWorkspaceParams,
  GetMeetingWorkspaceResponse,
  UpsertMeetingWorkspaceBody,
  UpsertMeetingWorkspaceParams,
  UpsertMeetingWorkspaceResponse,
} from "@workspace/api-zod";
import { db, meetingWorkspacesTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { isAccountActive } from "../lib/accountLifecycle";

const router: IRouter = Router();

function workspaceResponse(workspace: typeof meetingWorkspacesTable.$inferSelect) {
  return GetMeetingWorkspaceResponse.parse({
    id: workspace.id,
    ownerClerkUserId: workspace.ownerClerkUserId,
    ownerMeetingId: workspace.ownerMeetingId,
    publicToken: workspace.publicToken,
    workspace: workspace.workspace,
    revision: workspace.revision,
    revokedAt: workspace.revokedAt,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  });
}

router.get("/meeting-workspaces/:meetingId", requireAuth, async (req, res): Promise<void> => {
  const params = GetMeetingWorkspaceParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Meeting workspace not found" });
    return;
  }
  const [workspace] = await db.select().from(meetingWorkspacesTable).where(and(
    eq(meetingWorkspacesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
    eq(meetingWorkspacesTable.ownerMeetingId, params.data.meetingId),
  ));
  if (!workspace) {
    res.status(404).json({ error: "Meeting workspace not found" });
    return;
  }
  res.json(workspaceResponse(workspace));
});

router.put("/meeting-workspaces/:meetingId", requireAuth, async (req, res): Promise<void> => {
  const params = UpsertMeetingWorkspaceParams.safeParse(req.params);
  const parsed = UpsertMeetingWorkspaceBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid meeting workspace request" });
    return;
  }

  const ownerClerkUserId = getRequiredClerkUserId(res);
  try {
    const [current] = await db.select().from(meetingWorkspacesTable).where(and(
      eq(meetingWorkspacesTable.ownerClerkUserId, ownerClerkUserId),
      eq(meetingWorkspacesTable.ownerMeetingId, params.data.meetingId),
    ));

    if (!current) {
      const [created] = await db.insert(meetingWorkspacesTable).values({
        ownerClerkUserId,
        ownerMeetingId: params.data.meetingId,
        publicToken: randomBytes(24).toString("base64url"),
        workspace: parsed.data.workspace,
      }).returning();
      res.json(UpsertMeetingWorkspaceResponse.parse(workspaceResponse(created)));
      return;
    }

    if (parsed.data.expectedRevision === undefined || parsed.data.expectedRevision === null) {
      res.status(400).json({ error: "Expected revision is required when updating a meeting workspace" });
      return;
    }

    const [updated] = await db.update(meetingWorkspacesTable).set({
      workspace: parsed.data.workspace,
      revision: sql`${meetingWorkspacesTable.revision} + 1`,
      revokedAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(meetingWorkspacesTable.id, current.id),
      eq(meetingWorkspacesTable.ownerClerkUserId, ownerClerkUserId),
      eq(meetingWorkspacesTable.revision, parsed.data.expectedRevision),
    )).returning();

    if (!updated) {
      const [latest] = await db.select().from(meetingWorkspacesTable).where(and(
        eq(meetingWorkspacesTable.id, current.id),
        eq(meetingWorkspacesTable.ownerClerkUserId, ownerClerkUserId),
      ));
      if (!latest) {
        res.status(404).json({ error: "Meeting workspace not found" });
        return;
      }
      res.status(409).json({
        error: "Meeting workspace revision is stale",
        current: workspaceResponse(latest),
      });
      return;
    }
    res.json(UpsertMeetingWorkspaceResponse.parse(workspaceResponse(updated)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to save meeting workspace");
    res.status(500).json({ error: "Unable to save meeting workspace" });
  }
});

router.delete("/meeting-workspaces/:meetingId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteMeetingWorkspaceParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Meeting workspace not found" });
    return;
  }
  const [revoked] = await db.update(meetingWorkspacesTable).set({
    revokedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(meetingWorkspacesTable.ownerClerkUserId, getRequiredClerkUserId(res)),
    eq(meetingWorkspacesTable.ownerMeetingId, params.data.meetingId),
  )).returning({ id: meetingWorkspacesTable.id });
  if (!revoked) {
    res.status(404).json({ error: "Meeting workspace not found" });
    return;
  }
  res.status(204).send();
});

router.get("/meeting-recaps/:shareToken", async (req, res): Promise<void> => {
  const params = GetMeetingRecapParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Meeting recap not found" });
    return;
  }
  const [workspace] = await db.select().from(meetingWorkspacesTable).where(and(
    eq(meetingWorkspacesTable.publicToken, params.data.shareToken),
  ));
  if (!workspace || workspace.revokedAt || !(await isAccountActive(workspace.ownerClerkUserId))) {
    res.status(404).json({ error: "Meeting recap not found" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(GetMeetingRecapResponse.parse({
    workspace: workspace.workspace,
    revision: workspace.revision,
    updatedAt: workspace.updatedAt,
  }));
});

export default router;