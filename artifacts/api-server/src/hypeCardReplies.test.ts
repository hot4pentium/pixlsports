import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { mock } from "node:test";
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
  ListHypeCardSharesResponse,
  ListHypeCardShareRepliesResponse,
} from "@workspace/api-zod";
import hypeCardSharesRouter from "./routes/hypeCardShares";
import { ObjectStorageService } from "./lib/objectStorage";

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

    const unreadReplyId = replies.replies[0]!.id;
    const replyUrl = `${baseUrl}/${unreadReplyId}`;
    assert.equal((await fetch(replyUrl, { method: "DELETE", headers: { "x-test-user": otherId } })).status, 404);
    assert.equal((await fetch(replyUrl, { method: "DELETE", headers: { "x-test-user": ownerId } })).status, 204);
    const afterDelete = ListHypeCardShareRepliesResponse.parse(await (await fetch(baseUrl, {
      headers: { "x-test-user": ownerId },
    })).json());
    assert.equal(afterDelete.unreadCount, 4);
    assert.equal(afterDelete.replies.length, 4);
    assert.ok(!afterDelete.replies.some((reply) => reply.id === unreadReplyId));
    assert.equal((await fetch(replyUrl, { method: "DELETE", headers: { "x-test-user": ownerId } })).status, 404);

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

test("owned share listing can match the Athlete Hype Page video window", async () => {
  const ownerId = `hype-list-owner-${crypto.randomUUID()}`;
  const now = Date.now();
  const app = express();
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
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "supporter",
      accessMode: "full",
    });
    await db.insert(hypeCardSharesTable).values([
      {
        ownerClerkUserId: ownerId,
        publicToken: randomBytes(24).toString("base64url"),
        slug: "older-video",
        title: "Older video",
        manifest: {},
        shareMode: "card",
        mediaType: "video",
        videoObjectPath: "/test/older-video.mp4",
        videoContentType: "video/mp4",
        videoSize: 1,
        expiresAt: new Date(now + 60_000),
        createdAt: new Date(now),
      },
      {
        ownerClerkUserId: ownerId,
        publicToken: randomBytes(24).toString("base64url"),
        slug: "newer-image",
        title: "Newer image",
        manifest: {},
        shareMode: "card",
        mediaType: "image",
        videoObjectPath: "/test/newer-image.jpg",
        videoContentType: "image/jpeg",
        videoSize: 1,
        expiresAt: new Date(now + 60_000),
        createdAt: new Date(now + 1_000),
      },
      {
        ownerClerkUserId: ownerId,
        publicToken: randomBytes(24).toString("base64url"),
        slug: "newest-video",
        title: "Newest video",
        manifest: {},
        shareMode: "card",
        mediaType: "video",
        videoObjectPath: "/test/newest-video.webm",
        videoContentType: "video/webm",
        videoSize: 1,
        expiresAt: new Date(now + 60_000),
        createdAt: new Date(now + 2_000),
      },
    ]);

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/hype-card-shares`;
    const response = await fetch(`${baseUrl}?shareMode=card&mediaType=video&limit=1`, {
      headers: { "x-test-user": ownerId },
    });
    assert.equal(response.status, 200);
    const shares = ListHypeCardSharesResponse.parse(await response.json());
    assert.equal(shares.length, 1);
    assert.equal(shares[0]?.title, "Newest video");
    assert.equal(shares[0]?.mediaType, "video");
    assert.equal((await fetch(`${baseUrl}?limit=0`, {
      headers: { "x-test-user": ownerId },
    })).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("hosted Hype Card downloads require the active share owner", async () => {
  const ownerId = `hype-download-owner-${crypto.randomUUID()}`;
  const otherId = `hype-download-other-${crypto.randomUUID()}`;
  const now = Date.now();
  const tokens = {
    image: randomBytes(24).toString("base64url"),
    video: randomBytes(24).toString("base64url"),
    expired: randomBytes(24).toString("base64url"),
    revoked: randomBytes(24).toString("base64url"),
    stats: randomBytes(24).toString("base64url"),
  };
  const app = express();
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
  const getObjectEntityFile = mock.method(
    ObjectStorageService.prototype,
    "getObjectEntityFile",
    async (objectPath: string) => ({ objectPath }) as never,
  );
  const downloadObject = mock.method(
    ObjectStorageService.prototype,
    "downloadObject",
    async () => new Response("hosted-media", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }),
  );

  try {
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerId, role: "supporter", accessMode: "full" },
      { ownerClerkUserId: otherId, role: "supporter", accessMode: "full" },
    ]);
    const baseShare = {
      ownerClerkUserId: ownerId,
      title: "Hosted download",
      manifest: {},
      videoSize: 12,
      posterObjectPath: null,
      posterContentType: null,
      posterSize: null,
    };
    await db.insert(hypeCardSharesTable).values([
      {
        ...baseShare,
        publicToken: tokens.image,
        slug: "image-card",
        mediaType: "image",
        videoObjectPath: "/test/download-image",
        videoContentType: "image/png",
        expiresAt: new Date(now + 60_000),
      },
      {
        ...baseShare,
        publicToken: tokens.video,
        slug: "video-card",
        mediaType: "video",
        videoObjectPath: "/test/download-video",
        videoContentType: "video/mp4",
        expiresAt: new Date(now + 60_000),
      },
      {
        ...baseShare,
        publicToken: tokens.expired,
        slug: "expired-card",
        mediaType: "image",
        videoObjectPath: "/test/download-expired",
        videoContentType: "image/jpeg",
        expiresAt: new Date(now - 60_000),
      },
      {
        ...baseShare,
        publicToken: tokens.revoked,
        slug: "revoked-card",
        mediaType: "image",
        videoObjectPath: "/test/download-revoked",
        videoContentType: "image/jpeg",
        expiresAt: new Date(now + 60_000),
        revokedAt: new Date(now),
      },
      {
        ...baseShare,
        publicToken: tokens.stats,
        slug: "stats-card",
        shareMode: "stats",
        mediaType: "image",
        videoObjectPath: "/test/download-stats",
        videoContentType: "image/jpeg",
        expiresAt: new Date(now + 60_000),
      },
    ]);

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const downloadUrl = (token: string) =>
      `http://127.0.0.1:${address.port}/api/hype-card-shares/${token}/download`;
    const asOwner = { headers: { "x-test-user": ownerId } };

    const image = await fetch(downloadUrl(tokens.image), asOwner);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-disposition"), 'attachment; filename="image-card.png"');
    assert.equal(await image.text(), "hosted-media");

    const video = await fetch(downloadUrl(tokens.video), asOwner);
    assert.equal(video.status, 200);
    assert.equal(video.headers.get("content-disposition"), 'attachment; filename="video-card.mp4"');
    assert.equal(await video.text(), "hosted-media");

    assert.equal((await fetch(downloadUrl(tokens.image), {
      headers: { "x-test-user": otherId },
    })).status, 404);
    assert.equal((await fetch(downloadUrl(tokens.image))).status, 401);
    assert.equal((await fetch(downloadUrl(tokens.expired), asOwner)).status, 404);
    assert.equal((await fetch(downloadUrl(tokens.revoked), asOwner)).status, 404);
    assert.equal((await fetch(downloadUrl(tokens.stats), asOwner)).status, 404);
    assert.equal(getObjectEntityFile.mock.callCount(), 2);
    assert.equal(downloadObject.mock.callCount(), 2);
  } finally {
    getObjectEntityFile.mock.restore();
    downloadObject.mock.restore();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherId));
  }
});