import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { accountAccessTable, cloudProjectsTable, db } from "@workspace/db";
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