import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { accountAccessTable, cloudProjectsTable, db, soccerGearActivityTable } from "@workspace/db";
import projectsRouter from "./routes/projects";

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

test("finalized tracker games earn durable Locker progress once", async () => {
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
    assert.deepEqual(
      credits.filter((credit) => credit.kind === "tracker-game").map((credit) => credit.eventKey).sort(),
      ["game-final-1", "game-final-2"],
    );
  } finally {
    server.close();
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.ownerClerkUserId, ownerId));
    await db.delete(soccerGearActivityTable).where(eq(soccerGearActivityTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});