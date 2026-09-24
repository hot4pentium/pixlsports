import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { db, supporterActiveGamesTable } from "@workspace/db";
import supporterActiveGameRouter from "./routes/supporterActiveGame";

test("supporter active game selection is private, minimal, and clearable", async () => {
  const ownerId = `supporter-active-game-${crypto.randomUUID()}`;
  const otherOwnerId = `supporter-active-game-${crypto.randomUUID()}`;
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
  app.use("/api", supporterActiveGameRouter);
  const server = app.listen(0);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}/api/supporter/active-game`;
    const request = (userId?: string, init: RequestInit = {}) => fetch(endpoint, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(userId ? { "x-test-user": userId } : {}),
        ...init.headers,
      },
    });

    assert.equal((await request()).status, 401);
    assert.deepEqual(await request(ownerId).then((response) => response.json()), { gameId: null });

    const saved = await request(ownerId, {
      method: "PUT",
      body: JSON.stringify({ gameId: "game-chosen" }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { gameId: "game-chosen" });
    assert.deepEqual(await request(otherOwnerId).then((response) => response.json()), { gameId: null });

    const invalid = await request(ownerId, {
      method: "PUT",
      body: JSON.stringify({
        gameId: "game-other",
        notes: "Private checklist notes must not be accepted.",
        items: ["Private checklist items must not be accepted."],
      }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await request(ownerId).then((response) => response.json()), { gameId: "game-chosen" });

    const cleared = await request(ownerId, {
      method: "PUT",
      body: JSON.stringify({ gameId: null }),
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await cleared.json(), { gameId: null });
    assert.deepEqual(await request(ownerId).then((response) => response.json()), { gameId: null });
  } finally {
    await db.delete(supporterActiveGamesTable)
      .where(eq(supporterActiveGamesTable.ownerClerkUserId, ownerId));
    await db.delete(supporterActiveGamesTable)
      .where(eq(supporterActiveGamesTable.ownerClerkUserId, otherOwnerId));
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});