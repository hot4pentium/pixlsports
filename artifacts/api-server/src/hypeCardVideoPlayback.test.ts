import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import test, { mock } from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { accountAccessTable, db, hypeCardSharesTable } from "@workspace/db";
import router from "./routes/hypeCardShares";
import { ObjectStorageService } from "./lib/objectStorage";

test("public hosted video route preserves bounded Safari probes, seeks, suffixes and 416 responses", async () => {
  const owner = `video-playback-${crypto.randomUUID()}`;
  const token = randomBytes(24).toString("base64url");
  const size = 35 * 1024 * 1024;
  const chunk = 4 * 1024 * 1024;
  const reads: Array<{ start: number; end: number } | undefined> = [];
  const storage = mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => ({
    getMetadata: async () => [{ size: String(size) }],
    createReadStream: (range?: { start: number; end: number }) => {
      reads.push(range);
      return Readable.from([Buffer.alloc(range ? range.end - range.start + 1 : size, 0x61)]);
    },
  }));
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  try {
    await db.insert(accountAccessTable).values({ ownerClerkUserId: owner, role: "supporter", accessMode: "full" });
    await db.insert(hypeCardSharesTable).values({
      ownerClerkUserId: owner, publicToken: token, slug: "range-check", title: "Highlight",
      manifest: {}, mediaType: "video", videoObjectPath: "/test/playback",
      videoContentType: "video/mp4", videoSize: size,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/hype-card-shares/${token}/media/video`;
    for (const [header, start, end] of [
      ["bytes=0-1", 0, 1],
      ["bytes=0-", 0, chunk - 1],
      [`bytes=${chunk}-`, chunk, 2 * chunk - 1],
      ["bytes=-5", size - 5, size - 1],
    ] as const) {
      const response = await fetch(url, { headers: { Range: header } });
      assert.equal(response.status, 206, header);
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.equal(response.headers.get("content-type"), "video/mp4");
      assert.equal(response.headers.get("content-disposition"), "inline");
      assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${size}`);
      assert.equal(Number(response.headers.get("content-length")), end - start + 1);
      assert.equal((await response.arrayBuffer()).byteLength, end - start + 1);
      assert.deepEqual(reads.at(-1), { start, end });
    }
    const before = reads.length;
    const invalid = await fetch(url, { headers: { Range: `bytes=${size}-` } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), `bytes */${size}`);
    assert.equal((await invalid.arrayBuffer()).byteLength, 0);
    assert.equal(reads.length, before, "unsatisfiable ranges never open a storage stream");
    await db.update(hypeCardSharesTable).set({ revokedAt: new Date() }).where(eq(hypeCardSharesTable.publicToken, token));
    assert.equal((await fetch(url, { headers: { Range: "bytes=0-1" } })).status, 404);
    assert.equal(reads.length, before, "revoked links never stream media");
  } finally {
    storage.mock.restore();
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    await db.delete(hypeCardSharesTable).where(eq(hypeCardSharesTable.ownerClerkUserId, owner));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, owner));
  }
});
