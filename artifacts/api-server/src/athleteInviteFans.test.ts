import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { athleteInviteFansTable, athleteInvitesTable, db } from "@workspace/db";
import athleteInviteFeaturesRouter from "./routes/athleteInviteFeatures";

test("anonymous fan follow token scopes preference updates and deletion", async () => {
  const ownerId = `athlete-fan-owner-${randomUUID()}`;
  const sourceIp = `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
  const publicToken = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`;
  const originalVapid = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  };
  process.env.VAPID_PUBLIC_KEY = "configured-public";
  process.env.VAPID_PRIVATE_KEY = "configured-private";
  process.env.VAPID_SUBJECT = "mailto:test@example.test";
  const [invite] = await db.insert(athleteInvitesTable).values({
    ownerClerkUserId: ownerId,
    publicToken,
    athleteName: "Jordan",
    teamName: "City Hoops",
    seasonName: "Current",
    seasonEndsAt: new Date(Date.now() + 86_400_000),
    sport: "basketball",
    trackerProjectId: null,
    scheduleProjectId: null,
    showHypeCard: true,
    showStats: true,
    showSchedule: true,
    paused: false,
  }).returning();
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", athleteInviteFeaturesRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api/athlete-invites/${publicToken}`;
  try {
    const manifest = await fetch(`${baseUrl}/manifest.webmanifest?basePath=%2Fpreview`);
    assert.equal(manifest.status, 200);
    const install = await manifest.json() as {
      id: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };
    assert.equal(install.id, `/preview/fan/${publicToken}`);
    assert.equal(install.start_url, `/preview/fan/${publicToken}`);
    assert.equal(install.scope, "/preview/");
    assert.deepEqual(install.icons.map(({ sizes }) => sizes), ["192x192", "512x512"]);
    assert.ok(install.icons.every((icon) => icon.src.startsWith("/preview/api/athlete-invites/")));
    for (const size of [192, 512]) {
      const iconResponse = await fetch(`${baseUrl}/icon/${size}.png`);
      assert.equal(iconResponse.status, 200);
      assert.equal(iconResponse.headers.get("cache-control"), "no-store, max-age=0");
      const metadata = await sharp(Buffer.from(await iconResponse.arrayBuffer())).metadata();
      assert.equal(metadata.width, size);
      assert.equal(metadata.height, size);
    }
    const photoResponse = await fetch(`${baseUrl}/photo/image`);
    assert.equal(photoResponse.status, 404);
    assert.equal(photoResponse.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal((await fetch(`${baseUrl}/manifest.webmanifest?basePath=%2F..%2Fescape`)).status, 400);
    await db.update(athleteInvitesTable)
      .set({ seasonEndsAt: new Date(Date.now() - 86_400_000) })
      .where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await fetch(`${baseUrl}/manifest.webmanifest`)).status, 200,
      "the season date must not expire the durable fan card");

    const create = await fetch(`${baseUrl}/follows`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": sourceIp },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "public_encryption_key_".repeat(3), auth: "authentication-key" },
        liveAlerts: true,
        eventAlerts: false,
      }),
    });
    assert.equal(create.status, 201);
    const follow = await create.json() as { followToken: string; liveAlerts: boolean; eventAlerts: boolean };
    assert.equal(follow.liveAlerts, true);
    assert.equal(follow.eventAlerts, false);
    assert.equal(follow.followToken.length >= 40, true);

    const duplicate = await fetch(`${baseUrl}/follows`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": sourceIp },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "public_encryption_key_".repeat(3), auth: "authentication-key" },
        liveAlerts: true,
        eventAlerts: false,
      }),
    });
    assert.equal(duplicate.status, 409);

    const followHeaders = { "X-Fan-Follow-Token": follow.followToken };
    const status = await fetch(`${baseUrl}/follows/me`, { headers: followHeaders });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { liveAlerts: true, eventAlerts: false, active: true });
    assert.equal((await fetch(`${baseUrl}/follows/me`, {
      headers: { "X-Fan-Follow-Token": "knows-endpoint-only" },
    })).status, 404);

    const update = await fetch(`${baseUrl}/follows/me`, {
      method: "PATCH",
      headers: { ...followHeaders, "content-type": "application/json" },
      body: JSON.stringify({ liveAlerts: false, eventAlerts: true }),
    });
    assert.equal(update.status, 200);
    assert.deepEqual(await update.json(), { liveAlerts: false, eventAlerts: true, active: true });

    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invite.id));
    const pausedStatus = await fetch(`${baseUrl}/follows/me`, { headers: followHeaders });
    assert.equal(pausedStatus.status, 200);
    assert.deepEqual(await pausedStatus.json(), { liveAlerts: false, eventAlerts: true, active: false });
    const pausedPatch = await fetch(`${baseUrl}/follows/me`, {
      method: "PATCH",
      headers: { ...followHeaders, "content-type": "application/json" },
      body: JSON.stringify({ liveAlerts: true, eventAlerts: false }),
    });
    assert.equal(pausedPatch.status, 200);
    assert.deepEqual(await pausedPatch.json(), { liveAlerts: true, eventAlerts: false, active: false });
    assert.equal((await fetch(`${baseUrl}/follows`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": sourceIp },
      body: JSON.stringify({
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`,
        keys: { p256dh: "public_encryption_key_".repeat(3), auth: "authentication-key" },
        liveAlerts: true,
        eventAlerts: false,
      }),
    })).status, 404);
    assert.equal((await fetch(`${baseUrl}/manifest.webmanifest`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/follows/me`, {
      method: "DELETE",
      headers: followHeaders,
    })).status, 204);
  } finally {
    server.close();
    await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.inviteId, invite.id));
    await db.delete(athleteInvitesTable).where(and(
      eq(athleteInvitesTable.id, invite.id),
      eq(athleteInvitesTable.ownerClerkUserId, ownerId),
    ));
    if (originalVapid.publicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = originalVapid.publicKey;
    if (originalVapid.privateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = originalVapid.privateKey;
    if (originalVapid.subject === undefined) delete process.env.VAPID_SUBJECT;
    else process.env.VAPID_SUBJECT = originalVapid.subject;
  }
});

test("one browser endpoint can follow separate athlete invites independently", async () => {
  const ownerIds = [`fan-owner-${randomUUID()}`, `fan-owner-${randomUUID()}`];
  const sourceIp = `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
  const tokens = ownerIds.map(() => randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""));
  const endpoint = `https://updates.push.services.mozilla.com/wpush/v2/${randomUUID().replaceAll("-", "")}`;
  const invites = await db.insert(athleteInvitesTable).values(ownerIds.map((ownerClerkUserId, index) => ({
    ownerClerkUserId,
    publicToken: tokens[index]!,
    athleteName: `Athlete ${index}`,
    teamName: "Team",
    seasonName: "Season",
    seasonEndsAt: new Date(Date.now() + 86_400_000),
    sport: "basketball",
    timezone: "America/New_York",
    trackerProjectId: null,
    scheduleProjectId: null,
    showHypeCard: true,
    showStats: true,
    showSchedule: true,
    paused: false,
  }))).returning();
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", athleteInviteFeaturesRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const results = await Promise.all(tokens.map((token, index) => fetch(
      `http://127.0.0.1:${address.port}/api/athlete-invites/${token}/follows`,
      {
        method: "POST",
         headers: { "content-type": "application/json", "x-forwarded-for": sourceIp },
        body: JSON.stringify({
          endpoint,
          keys: { p256dh: "public_encryption_key_".repeat(3), auth: "authentication-key" },
          liveAlerts: index === 0,
          eventAlerts: index === 1,
        }),
      },
    )));
    assert.deepEqual(results.map((result) => result.status), [201, 201]);
    const values = await Promise.all(results.map((result) => result.json())) as Array<{
      liveAlerts: boolean;
      eventAlerts: boolean;
      followToken: string;
      active: boolean;
    }>;
    assert.deepEqual(values.map(({ liveAlerts, eventAlerts, active }) => ({ liveAlerts, eventAlerts, active })), [
      { liveAlerts: true, eventAlerts: false, active: true },
      { liveAlerts: false, eventAlerts: true, active: true },
    ]);
    assert.notEqual(values[0]!.followToken, values[1]!.followToken);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.endpoint, endpoint));
    for (const invite of invites) await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id));
  }
});