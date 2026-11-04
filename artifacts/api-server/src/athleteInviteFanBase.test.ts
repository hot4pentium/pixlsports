import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { accountAccessTable, athleteInviteFansTable, athleteInvitesTable, db } from "@workspace/db";
import router from "./routes/athleteInviteFeatures";

test("Fan Base stays owner-only while names and follows remain independent from alerts", async () => {
  const owner = `fan-base-owner-${randomUUID()}`;
  const otherOwner = `fan-base-other-${randomUUID()}`;
  const publicToken = randomBytes(32).toString("hex");
  await db.insert(accountAccessTable).values(
    [owner, otherOwner].map((ownerClerkUserId) => ({ ownerClerkUserId, role: "fan" as const, accessMode: "full" as const })),
  );
  const [invite] = await db.insert(athleteInvitesTable).values({
    ownerClerkUserId: owner, publicToken, athleteName: "Example Athlete",
    teamName: "Example Team", seasonName: "Current", sport: "soccer",
    seasonEndsAt: new Date(Date.now() + 86_400_000), showHypeCard: true, paused: false,
  }).returning();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.get("X-Test-User"), tokenType: "session_token" });
    (auth as unknown as Record<symbol, boolean>)[Symbol.for("@clerk/express.auth")] = true;
    Object.assign(req, { auth, log: { error() {}, warn() {} } });
    next();
  });
  app.use("/api", router);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/athlete-invites/${publicToken}`;
  const token = randomBytes(32).toString("hex");
  const followHeaders = { "Content-Type": "application/json", "X-Fan-Follow-Token": token };
  const patch = (data: unknown, headers = followHeaders) => fetch(`${base}/follows/me`, {
    method: "PATCH", headers, body: JSON.stringify(data),
  });
  try {
    const created = await fetch(`${base}/follows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ followToken: token }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), {
      followToken: token, displayName: null, active: true,
      liveAlerts: false, eventAlerts: false, preEventAlerts: false,
    });
    const retry = await fetch(`${base}/follows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ followToken: token }),
    });
    assert.equal(retry.status, 200, "a retry cannot double-count the device");
    assert.equal((await patch({ displayName: "  Alex  " })).status, 200);

    const legacyToken = randomBytes(32).toString("hex");
    await db.insert(athleteInviteFansTable).values({
      inviteId: invite!.id, followTokenHash: createHash("sha256").update(legacyToken).digest("hex"),
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      p256dh: "existing-key", auth: "existing-auth",
      liveAlerts: true, eventAlerts: false, preEventAlerts: true,
    });
    const legacyHeaders = { ...followHeaders, "X-Fan-Follow-Token": legacyToken };
    const namedLegacy = await patch({ displayName: "Aunt" }, legacyHeaders);
    assert.equal(namedLegacy.status, 200);
    const namedLegacyBody = await namedLegacy.json();
    assert.equal(namedLegacyBody.liveAlerts, true);
    assert.equal(namedLegacyBody.preEventAlerts, true, "name-only changes preserve existing alert consent");
    await patch({ liveAlerts: false, preEventAlerts: false }, legacyHeaders);
    const [retained] = await db.select().from(athleteInviteFansTable)
      .where(eq(athleteInviteFansTable.followTokenHash, createHash("sha256").update(legacyToken).digest("hex")));
    assert.equal(retained?.endpoint, null);
    assert.equal(retained?.displayName, "Aunt", "turning off alerts does not remove the follow or name");

    const summary = () => fetch(`${base}/fan-base`, { headers: { "X-Test-User": owner } });
    assert.equal((await fetch(`${base}/fan-base`)).status, 401);
    assert.equal((await fetch(`${base}/fan-base`, { headers: { "X-Test-User": otherOwner } })).status, 404);
    const ownerResponse = await summary();
    assert.equal(ownerResponse.status, 200);
    assert.equal(ownerResponse.headers.get("cache-control"), "private, no-store");
    const body = await ownerResponse.json();
    assert.deepEqual(Object.keys(body).sort(), ["anonymousFollows", "namedFans", "totalFollows"]);
    assert.equal(body.totalFollows, 2);
    assert.equal(body.anonymousFollows, 0);
    assert.deepEqual(body.namedFans.sort(), ["Alex", "Aunt"]);

    await patch({ displayName: null });
    assert.deepEqual(await (await summary()).json(), { totalFollows: 2, anonymousFollows: 1, namedFans: ["Aunt"] });
    assert.equal((await fetch(`${base}/follows/me`, { method: "DELETE", headers: followHeaders })).status, 204);
    assert.deepEqual(await (await summary()).json(), { totalFollows: 1, anonymousFollows: 0, namedFans: ["Aunt"] });
  } finally {
    server.close();
    await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.inviteId, invite!.id));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite!.id));
    for (const ownerClerkUserId of [owner, otherOwner]) {
      await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId));
    }
  }
});
