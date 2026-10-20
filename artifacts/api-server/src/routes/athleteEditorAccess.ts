import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAthleteInviteEditorAccessBody,
  CreateAthleteInviteEditorAccessResponse,
  GetAthleteEditorAccessResponse,
  GetAthleteInviteEditorAccessResponse,
  GetAthleteInviteParams,
  RevokeAthleteInviteEditorAccessParams,
  UpdateAthleteInviteAppearanceBody,
  UpdateAthleteEditorCardAppearanceResponse,
} from "@workspace/api-zod";
import {
  accountAccessTable,
  athleteEditorAccessTable,
  athleteInvitesTable,
  cloudProjectsTable,
  db,
} from "@workspace/db";
import { getRequiredClerkUserId, requireAuthenticatedIdentity, requireAuth, requireProjectEditorAuth } from "../middlewares/requireAuth";
import {
  ATHLETE_EDITOR_METADATA_KEY,
  createAthleteEditorClerkClient,
  getAthleteEditorAccessForUser,
  getLatestAthleteEditorAccessForInvite,
} from "../lib/athleteEditorAccess";
import { markAccountProvisioned } from "../lib/accountProvisioning";

const router: IRouter = Router();

function verifiedEmailMatches(user: {
  emailAddresses?: Array<{
    emailAddress?: string;
    verification?: { status?: string } | null;
  }>;
}, expected: string) {
  const normalized = expected.trim().toLowerCase();
  return (user.emailAddresses ?? []).some((address) =>
    address.verification?.status === "verified"
    && address.emailAddress?.trim().toLowerCase() === normalized
  );
}

function invitationResponse(access: typeof athleteEditorAccessTable.$inferSelect | null) {
  return GetAthleteInviteEditorAccessResponse.parse(access
    ? {
        emailAddress: access.athleteEmail,
        projectId: access.projectId,
        status: access.status,
        updatedAt: access.updatedAt,
      }
    : {
        emailAddress: null,
        projectId: null,
        status: "not_invited",
        updatedAt: null,
      });
}

function isUniqueConflict(error: unknown) {
  const candidates = [error, error instanceof Error ? error.cause : null];
  return candidates.some((candidate) => candidate
    && typeof candidate === "object"
    && "code" in candidate
    && (candidate as { code?: unknown }).code === "23505");
}

function isClerkUserNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error
    && (error as { status?: unknown }).status === 404);
}

router.get("/athlete-invites/:inviteToken/editor-access", requireAuth, async (req, res): Promise<void> => {
  const params = GetAthleteInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid athlete invite" });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select({ id: athleteInvitesTable.id })
    .from(athleteInvitesTable)
    .where(and(
      eq(athleteInvitesTable.publicToken, params.data.inviteToken),
      eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    ))
    .limit(1);
  if (!invite) {
    res.status(404).json({ error: "Athlete page not found" });
    return;
  }
  res.json(invitationResponse(await getLatestAthleteEditorAccessForInvite(invite.id)));
});

router.post("/athlete-invites/:inviteToken/editor-access", requireAuth, async (req, res): Promise<void> => {
  const params = GetAthleteInviteParams.safeParse(req.params);
  const parsed = CreateAthleteInviteEditorAccessBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Provide a valid email and optional HYPE Card project." });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select()
    .from(athleteInvitesTable)
    .where(and(
      eq(athleteInvitesTable.publicToken, params.data.inviteToken),
      eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    ))
    .limit(1);
  if (!invite) {
    res.status(404).json({ error: "Athlete page not found" });
    return;
  }
  const projectId = parsed.data.projectId ?? null;
  const [project] = projectId
    ? await db.select()
      .from(cloudProjectsTable)
      .where(and(
        eq(cloudProjectsTable.id, projectId),
        eq(cloudProjectsTable.ownerClerkUserId, ownerClerkUserId),
      ))
      .limit(1)
    : [undefined];
  const projectData = project?.project;
  if (projectId && (!project || !projectData || typeof projectData !== "object"
    || (projectData as Record<string, unknown>).tool !== "hype-card")) {
    res.status(400).json({ error: "Choose a HYPE Card owned by this account." });
    return;
  }

  const existing = await db.select({ id: athleteEditorAccessTable.id })
    .from(athleteEditorAccessTable)
    .where(and(
      eq(athleteEditorAccessTable.athleteInviteId, invite.id),
      inArray(athleteEditorAccessTable.status, ["pending", "active"]),
    ))
    .limit(1);
  if (existing.length) {
    res.status(409).json({ error: "An athlete invitation is already waiting for a response." });
    return;
  }
  if (projectId) {
    const activeProjectAccess = await db.select({ id: athleteEditorAccessTable.id })
      .from(athleteEditorAccessTable)
      .where(and(
        eq(athleteEditorAccessTable.projectId, projectId),
        inArray(athleteEditorAccessTable.status, ["pending", "active"]),
      ))
      .limit(1);
    if (activeProjectAccess.length) {
      res.status(409).json({ error: "This HYPE Card is already linked to an athlete sign-in." });
      return;
    }
  }

  const emailAddress = parsed.data.emailAddress.trim().toLowerCase();
  const clerk = createAthleteEditorClerkClient();
  const previousAccess = await getLatestAthleteEditorAccessForInvite(invite.id);
  if (previousAccess?.status === "revoked"
    && previousAccess.athleteClerkUserId
    && previousAccess.athleteEmail === emailAddress) {
    try {
      const existingAthlete = await clerk.users.getUser(previousAccess.athleteClerkUserId);
      const metadata = existingAthlete.publicMetadata as Record<string, unknown>;
      if (!verifiedEmailMatches(existingAthlete, emailAddress)
        || metadata[ATHLETE_EDITOR_METADATA_KEY] !== previousAccess.id) {
        res.status(409).json({ error: "This athlete sign-in cannot be restored with the selected email." });
        return;
      }
      let restored: typeof athleteEditorAccessTable.$inferSelect | undefined;
      try {
        [restored] = await db.update(athleteEditorAccessTable)
          .set({ projectId, status: "active", updatedAt: new Date() })
          .where(and(
            eq(athleteEditorAccessTable.id, previousAccess.id),
            eq(athleteEditorAccessTable.status, "revoked"),
          ))
          .returning();
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        res.status(409).json({ error: "This HYPE Card is already linked to an athlete sign-in." });
        return;
      }
      if (!restored) {
        res.status(409).json({ error: "Athlete access changed. Refresh the page and try again." });
        return;
      }
      res.status(200).json(CreateAthleteInviteEditorAccessResponse.parse(invitationResponse(restored)));
      return;
    } catch (error) {
      if (!isClerkUserNotFound(error)) {
        req.log.error({ err: error }, "Unable to verify the previously invited athlete");
        res.status(503).json({ error: "The athlete sign-in could not be verified. Try again." });
        return;
      }
    }
  }
  try {
    const existingUsers = await clerk.users.getUserList({ emailAddress: [emailAddress], limit: 1 });
    if (existingUsers.data.length) {
      res.status(409).json({ error: "That email already has a Pixl Sports sign-in. Use a separate athlete email." });
      return;
    }
  } catch (error) {
    req.log.error({ err: error }, "Unable to check athlete invitation email");
    res.status(503).json({ error: "The athlete email could not be checked. Try again." });
    return;
  }

  let access: typeof athleteEditorAccessTable.$inferSelect | undefined;
  let invitationId: string | null = null;
  try {
    [access] = await db.insert(athleteEditorAccessTable).values({
      ownerClerkUserId,
      athleteInviteId: invite.id,
      projectId,
      athleteEmail: emailAddress,
      status: "pending",
    }).returning();
    const invitation = await clerk.invitations.createInvitation({
      emailAddress,
      ignoreExisting: false,
      notify: true,
      publicMetadata: { [ATHLETE_EDITOR_METADATA_KEY]: access.id },
    });
    invitationId = invitation.id;
  } catch (error) {
    if (access) {
      await db.delete(athleteEditorAccessTable).where(eq(athleteEditorAccessTable.id, access.id));
    }
    const status = typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : null;
    if (status === 409 || status === 422 || isUniqueConflict(error)) {
      res.status(409).json({ error: "That email already has a Pixl Sports sign-in or invitation." });
      return;
    }
    req.log.error({ err: error }, "Unable to send athlete editor invitation");
    res.status(502).json({ error: "The athlete invitation could not be sent." });
    return;
  }
  if (!access || !invitationId) {
    res.status(502).json({ error: "The athlete invitation could not be sent." });
    return;
  }
  try {
    const [updated] = await db.update(athleteEditorAccessTable)
      .set({ clerkInvitationId: invitationId, updatedAt: new Date() })
      .where(eq(athleteEditorAccessTable.id, access.id))
      .returning();
    if (updated) access = updated;
  } catch (error) {
    req.log.error({ err: error, accessId: access.id }, "Invitation was sent but its receipt could not be saved");
  }
  res.status(201).json(CreateAthleteInviteEditorAccessResponse.parse(invitationResponse(access)));
});

router.delete("/athlete-invites/:inviteToken/editor-access", requireAuth, async (req, res): Promise<void> => {
  const params = RevokeAthleteInviteEditorAccessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid athlete invite" });
    return;
  }
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [invite] = await db.select({ id: athleteInvitesTable.id })
    .from(athleteInvitesTable)
    .where(and(
      eq(athleteInvitesTable.publicToken, params.data.inviteToken),
      eq(athleteInvitesTable.ownerClerkUserId, ownerClerkUserId),
    ))
    .limit(1);
  if (!invite) {
    res.status(404).json({ error: "Athlete page not found" });
    return;
  }
  const access = await getLatestAthleteEditorAccessForInvite(invite.id);
  if (!access || access.status === "revoked") {
    res.status(404).json({ error: "Athlete editor access not found" });
    return;
  }
  if (access.status === "pending" && access.clerkInvitationId) {
    try {
      await createAthleteEditorClerkClient().invitations.revokeInvitation(access.clerkInvitationId);
    } catch (error) {
      req.log.warn({ err: error }, "Clerk invitation could not be revoked; database access will still be blocked");
    }
  }
  await db.update(athleteEditorAccessTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(athleteEditorAccessTable.id, access.id));
  res.sendStatus(204);
});

router.get("/athlete-editor/access", requireAuthenticatedIdentity, async (req, res): Promise<void> => {
  const athleteClerkUserId = getRequiredClerkUserId(res);
  const clerk = createAthleteEditorClerkClient();
  let user: Awaited<ReturnType<typeof clerk.users.getUser>>;
  try {
    user = await clerk.users.getUser(athleteClerkUserId);
  } catch (error) {
    req.log.warn({ err: error }, "Unable to load athlete editor identity");
    res.status(503).json({ error: "Athlete sign-in could not be verified. Try again." });
    return;
  }

  const publicMetadata = user.publicMetadata as Record<string, unknown>;
  const metadataAccessId = publicMetadata[ATHLETE_EDITOR_METADATA_KEY];
  let access = await getAthleteEditorAccessForUser(athleteClerkUserId);
  if (!access) {
    if (typeof metadataAccessId !== "string") {
      res.status(403).json({ error: "This sign-in is not linked to an athlete editor invitation." });
      return;
    }
    const [pending] = await db.select()
      .from(athleteEditorAccessTable)
      .where(and(
        eq(athleteEditorAccessTable.id, metadataAccessId),
        eq(athleteEditorAccessTable.status, "pending"),
        isNull(athleteEditorAccessTable.athleteClerkUserId),
      ))
      .limit(1);
    if (!pending || !verifiedEmailMatches(user, pending.athleteEmail)) {
      res.status(403).json({ error: "Accept the invitation using its verified email address." });
      return;
    }
    const [claimed] = await db.update(athleteEditorAccessTable)
      .set({
        athleteClerkUserId,
        status: "active",
        updatedAt: new Date(),
      })
      .where(and(
        eq(athleteEditorAccessTable.id, pending.id),
        eq(athleteEditorAccessTable.status, "pending"),
        isNull(athleteEditorAccessTable.athleteClerkUserId),
      ))
      .returning();
    access = claimed ?? await getAthleteEditorAccessForUser(athleteClerkUserId);
  }

  if (!access || access.status !== "active"
    || metadataAccessId !== access.id
    || !verifiedEmailMatches(user, access.athleteEmail)) {
    res.status(403).json({ error: "Athlete editor access is no longer active." });
    return;
  }

  const [invite] = await db.select()
    .from(athleteInvitesTable)
    .where(and(
      eq(athleteInvitesTable.id, access.athleteInviteId),
      eq(athleteInvitesTable.ownerClerkUserId, access.ownerClerkUserId),
    ))
    .limit(1);
  const [project] = access.projectId
    ? await db.select()
      .from(cloudProjectsTable)
      .where(and(
        eq(cloudProjectsTable.id, access.projectId),
        eq(cloudProjectsTable.ownerClerkUserId, access.ownerClerkUserId),
      ))
      .limit(1)
    : [undefined];
  const projectData = project?.project;
  if (!invite || (access.projectId && (!project || !projectData || typeof projectData !== "object"
    || (projectData as Record<string, unknown>).tool !== "hype-card"))) {
    res.status(403).json({ error: "The linked HYPE Card is no longer available." });
    return;
  }

  await db.insert(accountAccessTable).values({
    ownerClerkUserId: athleteClerkUserId,
    role: "fan",
    accessMode: "full",
  }).onConflictDoNothing({ target: accountAccessTable.ownerClerkUserId });
  await markAccountProvisioned(athleteClerkUserId);

  const projectRecord = projectData && typeof projectData === "object"
    ? projectData as Record<string, unknown>
    : {};
  const appearanceRecord = invite.cardAppearance && typeof invite.cardAppearance === "object"
    ? invite.cardAppearance
    : {};
  res.json(GetAthleteEditorAccessResponse.parse({
    inviteToken: invite.publicToken,
    athleteName: invite.athleteName,
    teamName: invite.teamName,
    seasonName: invite.seasonName,
    sport: invite.sport,
    jerseyNumber: typeof projectRecord.jerseyNumber === "string"
      ? projectRecord.jerseyNumber
      : typeof appearanceRecord.jerseyNumber === "string" ? appearanceRecord.jerseyNumber : "",
    position: typeof projectRecord.position === "string"
      ? projectRecord.position
      : typeof appearanceRecord.position === "string" ? appearanceRecord.position : "",
    projectId: access.projectId,
  }));
});

router.patch("/athlete-editor/card/appearance", requireProjectEditorAuth, async (req, res): Promise<void> => {
  const parsed = UpdateAthleteInviteAppearanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose valid card colors and athlete placement." });
    return;
  }
  const athleteClerkUserId = getRequiredClerkUserId(res);
  const appearance = parsed.data;
  const updated = await db.transaction(async (tx) => {
    const [access] = await tx.select({ id: athleteEditorAccessTable.id, athleteInviteId: athleteEditorAccessTable.athleteInviteId, ownerClerkUserId: athleteEditorAccessTable.ownerClerkUserId })
      .from(athleteEditorAccessTable)
      .where(and(
        eq(athleteEditorAccessTable.athleteClerkUserId, athleteClerkUserId),
        eq(athleteEditorAccessTable.status, "active"),
        isNull(athleteEditorAccessTable.projectId),
      ))
      .limit(1)
      .for("update");
    if (!access) return null;
    const [linkedInvite] = await tx.select({ cardAppearance: athleteInvitesTable.cardAppearance })
      .from(athleteInvitesTable)
      .where(and(
        eq(athleteInvitesTable.id, access.athleteInviteId),
        eq(athleteInvitesTable.ownerClerkUserId, access.ownerClerkUserId),
      ))
      .limit(1)
      .for("update");
    if (!linkedInvite) return null;
    const savedAppearance = linkedInvite.cardAppearance && typeof linkedInvite.cardAppearance === "object"
      ? linkedInvite.cardAppearance
      : {};
    const [invite] = await tx.update(athleteInvitesTable)
      .set({
        cardAppearance: {
          ...appearance,
          jerseyNumber: typeof savedAppearance.jerseyNumber === "string" ? savedAppearance.jerseyNumber : "",
          position: typeof savedAppearance.position === "string" ? savedAppearance.position : "",
          accentColor: appearance.accentLinked ? appearance.borderColor : appearance.accentColor,
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(athleteInvitesTable.id, access.athleteInviteId),
        eq(athleteInvitesTable.ownerClerkUserId, access.ownerClerkUserId),
      ))
      .returning({ cardAppearance: athleteInvitesTable.cardAppearance });
    return invite ?? null;
  });
  if (!updated?.cardAppearance) {
    res.status(403).json({ error: "No active Showcase HYPE Card edit access." });
    return;
  }
  res.json(UpdateAthleteEditorCardAppearanceResponse.parse({ cardAppearance: updated.cardAppearance }));
});

export default router;
