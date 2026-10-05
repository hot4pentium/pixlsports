import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { accountAccessTable, athleteInvitesTable, supporterPhotosTable, db } from "@workspace/db";
import athleteInvitesRouter from "./routes/athleteInvites";
import { ObjectStorageService } from "./lib/objectStorage";

test("new HYPE Cards do not copy or remove a separate Athlete Profile photo", async (t) => {
  const owner = `first-card-no-profile-photo-${randomUUID()}`;
  const profileObjectPath = `/objects/profile-photo-${randomUUID()}`;
  let profilePhotoReads = 0;
  let cardPhotoCopies = 0;

  t.mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => {
    profilePhotoReads++;
    throw new Error("HYPE Card creation should not read an Athlete Profile photo");
  });
  t.mock.method(ObjectStorageService.prototype, "savePrivateObjectEntity", async () => {
    cardPhotoCopies++;
    return `/objects/unexpected-card-copy-${randomUUID()}`;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
    (auth as unknown as Record<symbol, unknown>)[Symbol.for("@clerk/express.auth")] = true;
    Object.assign(req, { auth, log: { error: () => undefined, warn: () => undefined } });
    next();
  });
  app.use("/api", athleteInvitesRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const payload = {
    athleteName: "Test Athlete",
    teamName: "Test Team",
    seasonName: "Test Season",
    seasonEndsAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    timezone: "UTC",
    sport: "basketball",
    trackerProjectId: null,
    scheduleProjectId: null,
    showHypeCard: true,
    showStats: true,
    showSchedule: false,
    hypesEnabled: true,
    paused: false,
  };

  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: owner,
      role: "fan",
      accessMode: "full",
    });
    await db.insert(supporterPhotosTable).values({
      ownerClerkUserId: owner,
      objectPath: profileObjectPath,
      contentType: "image/png",
      size: 123,
    });

    const response = await fetch(`${base}/athlete-invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": owner },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);
    const created = await response.json() as {
      inviteToken: string;
      photoUrl: string | null;
      photoRevision: string | null;
    };
    assert.equal(created.photoUrl, null);
    assert.equal(created.photoRevision, null);
    assert.equal(profilePhotoReads, 0);
    assert.equal(cardPhotoCopies, 0);

    const [storedPhoto] = await db.select().from(supporterPhotosTable)
      .where(eq(supporterPhotosTable.ownerClerkUserId, owner));
    assert.equal(storedPhoto?.objectPath, profileObjectPath);
    const [invite] = await db.select().from(athleteInvitesTable)
      .where(eq(athleteInvitesTable.ownerClerkUserId, owner));
    assert.equal(invite?.photoObjectPath, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.ownerClerkUserId, owner));
    await db.delete(supporterPhotosTable).where(eq(supporterPhotosTable.ownerClerkUserId, owner));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, owner));
  }
});