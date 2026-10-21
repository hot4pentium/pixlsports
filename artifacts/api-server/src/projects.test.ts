import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  athleteEditorAccessTable,
  athleteInvitesTable,
  cloudProjectsTable,
  db,
  projectMediaTable,
  soccerGearActivityTable,
} from "@workspace/db";
import { CreateAthleteInviteEditorAccessBody } from "@workspace/api-zod";
import projectsRouter from "./routes/projects";
import storageRouter from "./routes/storage";
import athleteEditorAccessRouter from "./routes/athleteEditorAccess";
import athleteInvitesRouter from "./routes/athleteInvites";

test("guest project creation rejects unsupported tools without persisting", async () => {
  const ownerId = `projects-guest-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", projectsRouter);
  const server = app.listen(0);

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "guest",
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user": ownerId,
      },
      body: JSON.stringify({
        name: "Unsupported project",
        project: { tool: "roster" },
      }),
    });
    assert.equal(response.status, 400);

    const projects = await db
      .select({ id: cloudProjectsTable.id })
      .from(cloudProjectsTable)
      .where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    assert.equal(projects.length, 0);
  } finally {
    server.close();
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("standalone Calendar projects cannot be created or updated while other projects remain editable", async () => {
  const ownerId = `projects-calendar-retirement-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", projectsRouter);
  const server = app.listen(0);
  const seededIds: string[] = [];

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const [legacySchedule] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Legacy calendar",
      project: { tool: "schedule", events: [] },
    }).returning();
    const [tracker] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Tracker",
      project: { tool: "stat-tracker", games: [] },
    }).returning();
    seededIds.push(legacySchedule.id, tracker.id);
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const headers = { "content-type": "application/json", "x-test-user": ownerId };

    const createCalendar = await fetch(`http://127.0.0.1:${address.port}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "New calendar",
        project: { tool: "schedule", events: [] },
      }),
    });
    assert.equal(createCalendar.status, 410);

    const updateCalendar = await fetch(`http://127.0.0.1:${address.port}/api/projects/${legacySchedule.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedRevision: 1, name: "Renamed calendar" }),
    });
    assert.equal(updateCalendar.status, 410);

    const convertProjectToCalendar = await fetch(`http://127.0.0.1:${address.port}/api/projects/${tracker.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        project: { tool: "schedule", events: [] },
      }),
    });
    assert.equal(convertProjectToCalendar.status, 410);

    const updateTracker = await fetch(`http://127.0.0.1:${address.port}/api/projects/${tracker.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedRevision: 1, name: "Updated tracker" }),
    });
    assert.equal(updateTracker.status, 200);
    const updated = await updateTracker.json() as { name: string; project: { tool: string } };
    assert.equal(updated.name, "Updated tracker");
    assert.equal(updated.project.tool, "stat-tracker");
  } finally {
    server.close();
    for (const id of seededIds) await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, id));
  }
});

test("finalized tracker games no longer accrue retired gear rewards", async () => {
  const ownerId = `projects-locker-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", projectsRouter);
  const server = app.listen(0);

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "fan",
      accessMode: "full",
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const headers = { "content-type": "application/json", "x-test-user": ownerId };
    const create = await fetch(`http://127.0.0.1:${address.port}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Tracker",
        project: {
          tool: "stat-tracker",
          games: [
            { id: "game-final-1", status: "final" },
            { id: "game-active", status: "active" },
          ],
        },
      }),
    });
    assert.equal(create.status, 201, await create.clone().text());
    const created = await create.json() as { id: string; revision: number };

    const update = await fetch(`http://127.0.0.1:${address.port}/api/projects/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        expectedRevision: created.revision,
        project: {
          tool: "stat-tracker",
          games: [
            { id: "game-final-1", status: "final" },
            { id: "game-final-2", status: "final" },
          ],
        },
      }),
    });
    assert.equal(update.status, 200, await update.clone().text());

    const credits = await db.select().from(soccerGearActivityTable)
      .where(eq(soccerGearActivityTable.ownerClerkUserId, ownerId));
    assert.deepEqual(credits.filter((credit) => credit.kind === "tracker-game"), []);
  } finally {
    server.close();
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await db.delete(soccerGearActivityTable).where(eq(soccerGearActivityTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("athlete editor access is limited to one HYPE Card and stops after revocation", async () => {
  const ownerId = `athlete-editor-owner-${crypto.randomUUID()}`;
  const athleteId = `athlete-editor-user-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", projectsRouter);
  app.use("/api", storageRouter);
  const server = app.listen(0);
  let accessId: string | undefined;
  let linkedProjectId: string | undefined;
  let unrelatedProjectId: string | undefined;
  let unrelatedMediaId: string | undefined;

  try {
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerId, role: "fan", accessMode: "full" },
      { ownerClerkUserId: athleteId, role: "fan", accessMode: "full" },
    ]);
    const [linkedProject] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Linked HYPE Card",
      project: { tool: "hype-card", headline: "Before athlete edit" },
    }).returning();
    const [unrelatedProject] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: ownerId,
      name: "Private tracker",
      project: { tool: "stat-tracker", games: [] },
    }).returning();
    linkedProjectId = linkedProject.id;
    unrelatedProjectId = unrelatedProject.id;
    const [unrelatedMedia] = await db.insert(projectMediaTable).values({
      ownerClerkUserId: ownerId,
      projectId: unrelatedProject.id,
      objectPath: `${ownerId}/private-tracker-photo.jpg`,
      name: "Private tracker photo",
      contentType: "image/jpeg",
      mediaType: "image",
      mediaRole: "photo",
      size: 100,
    }).returning({ id: projectMediaTable.id });
    unrelatedMediaId = unrelatedMedia.id;
    const [access] = await db.insert(athleteEditorAccessTable).values({
      ownerClerkUserId: ownerId,
      athleteInviteId: crypto.randomUUID(),
      projectId: linkedProject.id,
      athleteEmail: "athlete@example.com",
      athleteClerkUserId: athleteId,
      status: "active",
    }).returning();
    accessId = access.id;

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/projects`;
    const headers = { "content-type": "application/json", "x-test-user": athleteId };
    const list = await fetch(url, { headers });
    assert.equal(list.status, 200, await list.clone().text());
    const visibleProjects = await list.json() as Array<{ id: string }>;
    assert.deepEqual(visibleProjects.map((project) => project.id), [linkedProject.id]);

    const unrelated = await fetch(`${url}/${unrelatedProject.id}`, { headers });
    assert.equal(unrelated.status, 404);
    const unrelatedMediaRead = await fetch(`http://127.0.0.1:${address.port}/api/storage/media/${unrelatedMedia.id}`, { headers });
    assert.equal(unrelatedMediaRead.status, 404);
    const unrelatedMediaDelete = await fetch(`http://127.0.0.1:${address.port}/api/storage/media/${unrelatedMedia.id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(unrelatedMediaDelete.status, 404);
    const unrelatedUpload = await fetch(`http://127.0.0.1:${address.port}/api/storage/uploads/request-url`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId: unrelatedProject.id,
        name: "Not linked",
        mediaRole: "photo",
        mediaType: "image",
        contentType: "image/jpeg",
        size: 100,
      }),
    });
    assert.equal(unrelatedUpload.status, 403);
    const changeTool = await fetch(`${url}/${linkedProject.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        expectedRevision: linkedProject.revision,
        project: { tool: "stat-tracker", games: [] },
      }),
    });
    assert.equal(changeTool.status, 403);

    const parentOnlyCreate = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Another card", project: { tool: "hype-card" } }),
    });
    assert.equal(parentOnlyCreate.status, 403);

    const update = await fetch(`${url}/${linkedProject.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        expectedRevision: linkedProject.revision,
        project: { tool: "hype-card", headline: "Athlete edit" },
      }),
    });
    assert.equal(update.status, 200, await update.clone().text());
    const [updatedProject] = await db.select().from(cloudProjectsTable)
      .where(eq(cloudProjectsTable.id, linkedProject.id));
    assert.equal((updatedProject.project as { headline?: string }).headline, "Athlete edit");

    await db.update(athleteEditorAccessTable)
      .set({ status: "revoked" })
      .where(eq(athleteEditorAccessTable.id, access.id));
    const revokedList = await fetch(url, { headers });
    assert.equal(revokedList.status, 403);
  } finally {
    server.close();
    if (accessId) await db.delete(athleteEditorAccessTable).where(eq(athleteEditorAccessTable.id, accessId));
    if (unrelatedMediaId) await db.delete(projectMediaTable).where(eq(projectMediaTable.id, unrelatedMediaId));
    if (linkedProjectId) await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, linkedProjectId));
    if (unrelatedProjectId) await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, unrelatedProjectId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, athleteId));
  }
});

test("active athlete editor can update only the linked Showcase card appearance", async () => {
  const ownerId = `athlete-showcase-owner-${crypto.randomUUID()}`;
  const athleteId = `athlete-showcase-user-${crypto.randomUUID()}`;
  const inviteToken = `athlete-showcase-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", athleteEditorAccessRouter, athleteInvitesRouter);
  const server = app.listen(0);
  let inviteId: string | undefined;
  let accessId: string | undefined;
  const appearance = {
    design: "velocity",
    borderColor: "#123456",
    accentColor: "#ABCDEF",
    accentLinked: false,
    athleteX: 0.1,
    athleteY: -0.05,
    athleteScale: 1.2,
    jerseyNumber: "17",
    position: "Striker",
  };

  try {
    assert.equal(
      CreateAthleteInviteEditorAccessBody.safeParse({ emailAddress: "athlete@example.com" }).success,
      true,
      "new invitations do not require a separate HYPE Card project",
    );
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerId, role: "fan", accessMode: "full" },
      { ownerClerkUserId: athleteId, role: "fan", accessMode: "full" },
    ]);
    const [invite] = await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: ownerId,
      publicToken: inviteToken,
      athleteName: "Jordan",
      teamName: "Comets",
      seasonName: "2026",
      seasonEndsAt: new Date("2026-12-31T00:00:00.000Z"),
      sport: "soccer",
      cardAppearance: { design: "velocity", jerseyNumber: "8", position: "Forward" },
      showHypeCard: true,
      paused: false,
    }).returning({ id: athleteInvitesTable.id });
    inviteId = invite.id;
    const [access] = await db.insert(athleteEditorAccessTable).values({
      ownerClerkUserId: ownerId,
      athleteInviteId: invite.id,
      projectId: null,
      athleteEmail: "athlete@example.com",
      athleteClerkUserId: athleteId,
      status: "active",
    }).returning({ id: athleteEditorAccessTable.id });
    accessId = access.id;

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/athlete-editor/card/appearance`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-test-user": athleteId,
      },
      body: JSON.stringify(appearance),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as { cardAppearance: Record<string, unknown> };
    assert.equal(body.cardAppearance.jerseyNumber, "8", "athletes cannot change their profile number in the card editor");
    assert.equal(body.cardAppearance.position, "Forward", "athletes cannot change their profile position in the card editor");
    assert.equal(body.cardAppearance.accentColor, "#ABCDEF");
    const [updatedInvite] = await db.select({ cardAppearance: athleteInvitesTable.cardAppearance })
      .from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((updatedInvite.cardAppearance as { design?: string }).design, "velocity");

    const momentUrl = `http://127.0.0.1:${address.port}/api/athlete-editor/card/favorite-moment`;
    const momentHeaders = { "content-type": "application/json", "x-test-user": athleteId };
    const tooLong = await fetch(momentUrl, {
      method: "PATCH",
      headers: momentHeaders,
      body: JSON.stringify({ favoriteMoment: "x".repeat(161) }),
    });
    assert.equal(tooLong.status, 400, "the API enforces the 160-character limit");
    const favoriteMoment = "I stayed focused and scored my first goal.";
    const saveMoment = await fetch(momentUrl, {
      method: "PATCH",
      headers: momentHeaders,
      body: JSON.stringify({ favoriteMoment }),
    });
    assert.equal(saveMoment.status, 200, await saveMoment.clone().text());
    assert.deepEqual(await saveMoment.json(), { favoriteMoment });
    const [savedMoment] = await db.select({ favoriteMoment: athleteInvitesTable.favoriteMoment })
      .from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.id, invite.id));
    assert.equal(savedMoment.favoriteMoment, favoriteMoment, "the note persists on its linked athlete invite");

    const parentCannotEditMoment = await fetch(momentUrl, {
      method: "PATCH",
      headers: { ...momentHeaders, "x-test-user": ownerId },
      body: JSON.stringify({ favoriteMoment: "An owner-authored replacement" }),
    });
    assert.equal(parentCannotEditMoment.status, 403, "only the linked athlete can author the note");

    const publicFanUrl = `http://127.0.0.1:${address.port}/api/athlete-invites/${inviteToken}/fan`;
    const publishedCard = await fetch(publicFanUrl);
    assert.equal(publishedCard.status, 200, await publishedCard.clone().text());
    assert.equal((await publishedCard.json() as { favoriteMoment: string | null }).favoriteMoment, favoriteMoment);

    await db.update(athleteInvitesTable)
      .set({ showHypeCard: false })
      .where(eq(athleteInvitesTable.id, invite.id));
    const unpublishedCard = await fetch(publicFanUrl);
    assert.equal(unpublishedCard.status, 200, await unpublishedCard.clone().text());
    assert.equal((await unpublishedCard.json() as { favoriteMoment: string | null }).favoriteMoment, null);

    await db.update(athleteInvitesTable)
      .set({ showHypeCard: true, paused: true })
      .where(eq(athleteInvitesTable.id, invite.id));
    const pausedCard = await fetch(publicFanUrl);
    assert.equal(pausedCard.status, 404, "pausing the parent-controlled share hides the note with the card");

    await db.update(athleteEditorAccessTable)
      .set({ status: "revoked" })
      .where(eq(athleteEditorAccessTable.id, access.id));
    const revokedSave = await fetch(url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-test-user": athleteId,
      },
      body: JSON.stringify({ ...appearance, jerseyNumber: "99" }),
    });
    assert.equal(revokedSave.status, 403);
    const [unchangedInvite] = await db.select({ cardAppearance: athleteInvitesTable.cardAppearance })
      .from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((unchangedInvite.cardAppearance as { jerseyNumber?: string }).jerseyNumber, "8");
  } finally {
    server.close();
    if (accessId) await db.delete(athleteEditorAccessTable).where(eq(athleteEditorAccessTable.id, accessId));
    if (inviteId) await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, inviteId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, athleteId));
  }
});