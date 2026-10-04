import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { accountAccessTable, athleteInvitesTable, supporterPhotosTable, db } from "@workspace/db";
import athleteInvitesRouter from "./routes/athleteInvites";
import athleteInviteFeaturesRouter from "./routes/athleteInviteFeatures";
import supporterPhotoRouter from "./routes/supporterPhoto";
import { ObjectStorageService } from "./lib/objectStorage";

test("first-card creation copies only the owner's profile photo and preserves independent lifecycles", async (t) => {
  const owners = Array.from({ length: 4 }, () => `first-photo-${randomUUID()}`);
  const [owner, noPhotoOwner, retryOwner, raceOwner] = owners;
  const objects = new Map<string, Buffer>();
  const savedPaths: string[] = [];
  const deletedPaths: string[] = [];
  let raceBarrier: Promise<void> | null = null;
  let releaseRace: (() => void) | undefined;
  let raceSaves = 0;
  let failStorage = false;
  t.mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async (path: string) => ({
    download: async () => {
      const bytes = objects.get(path);
      if (!bytes) throw new Error("Missing test source");
      return [Buffer.from(bytes)];
    },
  }));
  t.mock.method(ObjectStorageService.prototype, "savePrivateObjectEntity", async (
    contents: Buffer, contentType: string, userId: string,
  ) => {
    assert.equal(contentType, "image/webp");
    assert.ok(owners.includes(userId));
    if (failStorage) throw new Error("Test storage failure");
    const path = `/objects/test-card-${randomUUID()}`;
    objects.set(path, Buffer.from(contents));
    savedPaths.push(path);
    if (userId === raceOwner && raceBarrier) {
      if (++raceSaves === 2) releaseRace?.();
      await raceBarrier;
    }
    return path;
  });
  t.mock.method(ObjectStorageService.prototype, "deleteObjectEntity", async (path: string) => {
    objects.delete(path);
    deletedPaths.push(path);
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
    (auth as unknown as Record<symbol, unknown>)[Symbol.for("@clerk/express.auth")] = true;
    Object.assign(req, { auth, log: { error: () => undefined, warn: () => undefined } });
    next();
  });
  app.use("/api", athleteInvitesRouter, athleteInviteFeaturesRouter, supporterPhotoRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const payload = {
    athleteName: "Test Athlete", teamName: "Test Team", seasonName: "Test Season",
    seasonEndsAt: new Date(Date.now() + 60 * 86400000).toISOString(),
    timezone: "UTC", sport: "basketball", trackerProjectId: null, scheduleProjectId: null,
    showHypeCard: true, showStats: true, showSchedule: false, hypesEnabled: true, paused: false,
  };
  const create = (userId: string) => fetch(`${base}/athlete-invites`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-test-user": userId },
    body: JSON.stringify(payload),
  });
  const profile = async (userId: string, bytes: Buffer) => {
    const path = `/objects/test-profile-${randomUUID()}`;
    objects.set(path, bytes);
    await db.insert(supporterPhotosTable).values({
      ownerClerkUserId: userId, objectPath: path, contentType: "image/png", size: bytes.length,
    });
    return path;
  };
  try {
    await db.insert(accountAccessTable).values(owners.map(ownerClerkUserId => ({
      ownerClerkUserId, role: "fan" as const, accessMode: "full" as const,
    })));
    const original = await sharp({
      create: { width: 2100, height: 1200, channels: 3, background: "#339966" },
    }).withMetadata().png().toBuffer();
    const sourcePath = await profile(owner, original);
    const createdResponse = await create(owner);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { inviteToken: string; photoUrl: string; photoRevision: string };
    assert.ok(created.photoUrl && created.photoRevision);
    const [row] = await db.select().from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.ownerClerkUserId, owner));
    assert.ok(row.photoObjectPath && row.photoObjectPath !== sourcePath);
    const cardPath = row.photoObjectPath;
    const cardBytes = objects.get(cardPath)!;
    const metadata = await sharp(cardBytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.ok(metadata.width! <= 2048);
    assert.deepEqual(objects.get(sourcePath), original);
    // Both owner and signed-out re-fetches receive the card's hosted image.
    for (const headers of [new Headers({ "x-test-user": owner }), new Headers()]) {
      const result = await fetch(`${base}/athlete-invites/${created.inviteToken}/fan`, { headers });
      assert.equal(result.status, 200);
      assert.equal((await result.json() as { photoUrl: string }).photoUrl, created.photoUrl);
      const image = await fetch(new URL(created.photoUrl, base), { headers });
      assert.equal(image.status, 200);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), cardBytes);
    }
    // A different owner cannot inherit the available profile image.
    const emptyResponse = await create(noPhotoOwner);
    assert.equal(emptyResponse.status, 201);
    assert.equal((await emptyResponse.json() as { photoUrl: string | null }).photoUrl, null);
    const savesBeforeConflict = savedPaths.length;
    assert.equal((await create(owner)).status, 409);
    assert.equal(savedPaths.length, savesBeforeConflict);
    // Changing/removing the profile source must not affect the public copy.
    objects.set(sourcePath, Buffer.from("replacement"));
    const updated = await fetch(`${base}/athlete-invites/${created.inviteToken}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-test-user": owner },
      body: JSON.stringify({ ...payload, seasonName: "Updated Season" }),
    });
    assert.equal(updated.status, 200, "ordinary edits do not read or recopy the profile photo");
    assert.deepEqual(objects.get(cardPath), cardBytes);
    const removed = await fetch(`${base}/supporter-photo`, { method: "DELETE", headers: { "x-test-user": owner } });
    assert.equal(removed.status, 204);
    assert.deepEqual(objects.get(cardPath), cardBytes);
    const publicImage = await fetch(new URL(created.photoUrl, base));
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), cardBytes);

    await t.test("unreadable, invalid, or unstorable photos fail before creation and allow a clean retry", async () => {
      const retryPath = await profile(retryOwner, Buffer.from("invalid image"));
      for (const source of [undefined, Buffer.from("invalid image")]) {
        if (source) objects.set(retryPath, source); else objects.delete(retryPath);
        const failed = await create(retryOwner);
        assert.equal(failed.status, 500);
        assert.match((await failed.json() as { error: string }).error, /profile photo could not be copied/);
        assert.equal((await db.select().from(athleteInvitesTable)
          .where(eq(athleteInvitesTable.ownerClerkUserId, retryOwner))).length, 0);
      }
      objects.set(retryPath, original);
      failStorage = true;
      const storageFailure = await create(retryOwner);
      assert.equal(storageFailure.status, 500);
      assert.equal((await db.select().from(athleteInvitesTable)
        .where(eq(athleteInvitesTable.ownerClerkUserId, retryOwner))).length, 0);
      failStorage = false;
      const retried = await create(retryOwner);
      assert.equal(retried.status, 201);
      const retryCard = await retried.json() as { inviteToken: string };
      await fetch(`${base}/athlete-invites/${retryCard.inviteToken}/photo`, {
        method: "DELETE", headers: { "x-test-user": retryOwner },
      });
      assert.deepEqual(objects.get(retryPath), original, "card removal preserves the profile original");
    });

    await t.test("concurrent creation retains one card and removes the losing prepared copy", async () => {
      const raceSource = await profile(raceOwner, original);
      raceBarrier = new Promise<void>(resolve => { releaseRace = resolve; });
      const before = savedPaths.length;
      const responses = await Promise.all([create(raceOwner), create(raceOwner)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      const copies = savedPaths.slice(before);
      assert.equal(copies.length, 2);
      assert.equal(copies.filter(path => objects.has(path)).length, 1);
      assert.equal(copies.filter(path => deletedPaths.includes(path)).length, 1);
      assert.deepEqual(objects.get(raceSource), original);
    });
  } finally {
    releaseRace?.();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(inArray(athleteInvitesTable.ownerClerkUserId, owners));
    await db.delete(supporterPhotosTable).where(inArray(supporterPhotosTable.ownerClerkUserId, owners));
    await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, owners));
  }
});