import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  db,
  hypeCardShareRepliesTable,
  hypeCardSharesTable,
} from "@workspace/db";
import {
  CreateHypeCardShareReplyResponse,
  ListHypeCardShareRepliesResponse,
} from "@workspace/api-zod";
import hypeCardSharesRouter from "./routes/hypeCardShares";

test("anonymous replies enforce ownership, read state, active shares, and an atomic quota", async () => {
  const ownerId = `hype-reply-owner-${crypto.randomUUID()}`;
  const otherId = `hype-reply-other-${crypto.randomUUID()}`;
  const publicToken = randomBytes(24).toString("base64url");
  let shareId: string | null = null;
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { warn: () => undefined, error: () => undefined };
    next();
  });
  app.use("/api", hypeCardSharesRouter);
  const server = app.listen(0);

  try {
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerId, role: "supporter", accessMode: "full" },
      { ownerClerkUserId: otherId, role: "supporter", accessMode: "full" },
    ]);
    const [share] = await db.insert(hypeCardSharesTable).values({
      ownerClerkUserId: ownerId,
      publicToken,
      slug: "reply-test",
      title: "Reply test",
      manifest: {},
      mediaType: "image",
      videoObjectPath: "/test/reply-image",
      videoContentType: "image/jpeg",
      videoSize: 1,
      posterObjectPath: "/test/reply-image",
      posterContentType: "image/jpeg",
      posterSize: 1,
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    shareId = share.id;
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/hype-card-shares/${publicToken}/replies`;
    const shareUrl = `http://127.0.0.1:${address.port}/api/hype-card-shares/${publicToken}`;
    const sendReply = () => fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reaction: "🔥", message: "Great play!" }),
    });

    const replyResponses = await Promise.all(Array.from({ length: 6 }, sendReply));
    assert.deepEqual(
      replyResponses.map((response) => response.status).sort(),
      [201, 201, 201, 201, 201, 429],
    );
    for (const response of replyResponses.filter((item) => item.status === 201)) {
      CreateHypeCardShareReplyResponse.parse(await response.json());
    }

    const otherList = await fetch(baseUrl, { headers: { "x-test-user": otherId } });
    assert.equal(otherList.status, 404);
    assert.equal((await fetch(shareUrl, { method: "DELETE", headers: { "x-test-user": otherId } })).status, 404);
    assert.equal((await fetch(baseUrl, { method: "DELETE", headers: { "x-test-user": ownerId } })).status, 404);

    const ownerList = await fetch(baseUrl, { headers: { "x-test-user": ownerId } });
    assert.equal(ownerList.status, 200);
    const replies = ListHypeCardShareRepliesResponse.parse(await ownerList.json());
    assert.equal(replies.unreadCount, 5);
    assert.equal(replies.replies.length, 5);
    assert.equal(replies.replies[0]?.message, "Great play!");

    const marked = await fetch(baseUrl, { method: "PATCH", headers: { "x-test-user": ownerId } });
    assert.equal(marked.status, 204);
    const readList = ListHypeCardShareRepliesResponse.parse(await (await fetch(baseUrl, {
      headers: { "x-test-user": ownerId },
    })).json());
    assert.equal(readList.unreadCount, 0);
    assert.ok(readList.replies.every((reply) => reply.isRead));

    await db.update(hypeCardSharesTable).set({ revokedAt: new Date() }).where(eq(hypeCardSharesTable.id, share.id));
    assert.equal((await sendReply()).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (shareId) await db.delete(hypeCardShareRepliesTable).where(eq(hypeCardShareRepliesTable.shareId, shareId));
    await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherId));
  }
});