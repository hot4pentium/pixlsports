import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { GetAthleteFanCardResponse } from "@workspace/api-zod";
import {
  accountAccessTable,
  athleteInviteFansTable,
  athleteInvitePhotoUploadClaimsTable,
  athleteInvitesTable,
  db,
} from "@workspace/db";
import athleteInvitesRouter from "./routes/athleteInvites";
import athleteInviteFeaturesRouter from "./routes/athleteInviteFeatures";
import { ObjectNotFoundError, ObjectStorageService } from "./lib/objectStorage";

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
  await db.insert(accountAccessTable).values({
    ownerClerkUserId: ownerId,
    role: "fan",
    accessMode: "full",
    lifecycleStatus: "active",
  });
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
        eventAlerts: true,
      }),
    });
    assert.equal(create.status, 201);
    const follow = await create.json() as {
      followToken: string;
      liveAlerts: boolean;
      eventAlerts: boolean;
      preEventAlerts: boolean;
    };
    assert.equal(follow.liveAlerts, true);
    assert.equal(follow.eventAlerts, true);
    assert.equal(follow.preEventAlerts, false);
    assert.equal(follow.followToken.length >= 40, true);

    const duplicate = await fetch(`${baseUrl}/follows`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": sourceIp },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "public_encryption_key_".repeat(3), auth: "authentication-key" },
        liveAlerts: true,
        eventAlerts: true,
      }),
    });
    assert.equal(duplicate.status, 409);

    const followHeaders = { "X-Fan-Follow-Token": follow.followToken };
    const status = await fetch(`${baseUrl}/follows/me`, { headers: followHeaders });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      liveAlerts: true,
      eventAlerts: true,
      preEventAlerts: false,
      active: true,
    });
    assert.equal((await fetch(`${baseUrl}/follows/me`, {
      headers: { "X-Fan-Follow-Token": "knows-endpoint-only" },
    })).status, 404);

    const update = await fetch(`${baseUrl}/follows/me`, {
      method: "PATCH",
      headers: { ...followHeaders, "content-type": "application/json" },
      body: JSON.stringify({ liveAlerts: false, preEventAlerts: true }),
    });
    assert.equal(update.status, 200);
    assert.deepEqual(await update.json(), {
      liveAlerts: false,
      eventAlerts: true,
      preEventAlerts: true,
      active: true,
    });

    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invite.id));
    const pausedStatus = await fetch(`${baseUrl}/follows/me`, { headers: followHeaders });
    assert.equal(pausedStatus.status, 200);
    assert.deepEqual(await pausedStatus.json(), {
      liveAlerts: false,
      eventAlerts: true,
      preEventAlerts: true,
      active: false,
    });
    const pausedPatch = await fetch(`${baseUrl}/follows/me`, {
      method: "PATCH",
      headers: { ...followHeaders, "content-type": "application/json" },
      body: JSON.stringify({ liveAlerts: true, eventAlerts: false }),
    });
    assert.equal(pausedPatch.status, 200);
    assert.deepEqual(await pausedPatch.json(), {
      liveAlerts: true,
      eventAlerts: false,
      preEventAlerts: false,
      active: false,
    });
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
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
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
  await db.insert(accountAccessTable).values(ownerIds.map((ownerClerkUserId) => ({
    ownerClerkUserId,
    role: "fan" as const,
    accessMode: "full" as const,
    lifecycleStatus: "active" as const,
  })));
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
      preEventAlerts: boolean;
      followToken: string;
      active: boolean;
    }>;
    assert.deepEqual(values.map(({ liveAlerts, eventAlerts, preEventAlerts, active }) => ({
      liveAlerts,
      eventAlerts,
      preEventAlerts,
      active,
    })), [
      { liveAlerts: true, eventAlerts: false, preEventAlerts: false, active: true },
      { liveAlerts: false, eventAlerts: true, preEventAlerts: false, active: true },
    ]);
    assert.notEqual(values[0]!.followToken, values[1]!.followToken);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInviteFansTable).where(eq(athleteInviteFansTable.endpoint, endpoint));
    for (const invite of invites) await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerIds[0]!));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerIds[1]!));
  }
});

test("removed or paused athlete photos stop loading at their existing public URLs", async (t) => {
  const ownerId = `athlete-photo-owner-${randomUUID()}`;
  const otherId = `athlete-photo-other-${randomUUID()}`;
  const publicToken = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const photoPath = `/objects/athlete-invite-photos/${randomUUID()}.webp`;
  const cutoutPath = `/objects/athlete-invite-photos/${randomUUID()}.webp`;
  const photoBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#d22" } })
    .webp().toBuffer();
  const cutoutBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .webp().toBuffer();
  const objects = new Map([[photoPath, photoBytes], [cutoutPath, cutoutBytes]]);

  await db.insert(accountAccessTable).values({
    ownerClerkUserId: ownerId,
    role: "fan",
    accessMode: "full",
    lifecycleStatus: "active",
  });
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
    photoObjectPath: photoPath,
    cutoutObjectPath: cutoutPath,
  }).returning();

  t.mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async (objectPath: string) => {
    const bytes = objects.get(objectPath);
    if (!bytes) throw new ObjectNotFoundError();
    return { download: async () => [bytes] } as never;
  });
  t.mock.method(ObjectStorageService.prototype, "deleteObjectEntity", async (objectPath: string) => {
    if (!objects.delete(objectPath)) throw new ObjectNotFoundError();
  });

  const app = express();
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", athleteInviteFeaturesRouter);
  app.use("/api", athleteInvitesRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const cardUrl = `${origin}/api/athlete-invites/${publicToken}/fan`;
  const baseUrl = `${origin}/api/athlete-invites/${publicToken}/photo/image`;
  const iconUrls = [192, 512].map((size) => `${origin}/api/athlete-invites/${publicToken}/icon/${size}.png`);
  const removeUrl = baseUrl.replace(/\/photo\/image$/, "/photo");
  const ownerHeaders = { "x-test-user": ownerId };
  const otherHeaders = { "x-test-user": otherId };

  try {
    const activeCardResponse = await fetch(cardUrl);
    assert.equal(activeCardResponse.status, 200);
    const activeCard = GetAthleteFanCardResponse.parse(await activeCardResponse.json());
    assert.ok(activeCard.photoUrl, "active public card data includes the athlete photo URL");
    assert.ok(activeCard.cutoutUrl, "active public card data includes the transparent cutout URL");
    const previouslyIssuedUrls = [
      new URL(activeCard.photoUrl, origin).toString(),
      new URL(activeCard.cutoutUrl, origin).toString(),
    ];
    for (const [url, expectedBytes] of [
      [previouslyIssuedUrls[0]!, photoBytes],
      [previouslyIssuedUrls[1]!, cutoutBytes],
    ] as const) {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /image\/webp/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expectedBytes);
    }
    const activeIcons = await Promise.all(iconUrls.map(async (url, index) => {
      const response = await fetch(url);
      assert.equal(response.status, 200, "active HYPE Cards serve their install icons to public visitors");
      assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      const size = index === 0 ? 192 : 512;
      assert.equal(metadata.width, size);
      assert.equal(metadata.height, size);
      return bytes;
    }));

    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await fetch(cardUrl)).status, 404, "paused cards are not available through the public card endpoint");
    for (const url of previouslyIssuedUrls) {
      assert.equal((await fetch(url)).status, 404, "paused photos are unavailable to public visitors");
      assert.equal((await fetch(url, { headers: otherHeaders })).status, 404, "paused photos are unavailable to other accounts");
      assert.equal((await fetch(url, { headers: ownerHeaders })).status, 200, "the owner can still load paused photos");
    }
    for (const url of iconUrls) {
      const response = await fetch(url);
      assert.equal(response.status, 404, "known install icon URLs are unavailable to public visitors while paused");
      assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    }

    await db.update(athleteInvitesTable).set({ paused: false }).where(eq(athleteInvitesTable.id, invite.id));
    for (const [index, url] of iconUrls.entries()) {
      const response = await fetch(url);
      assert.equal(response.status, 200, "resuming a HYPE Card restores its public install icons");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), activeIcons[index],
        "resuming restores the same icon response at the previously known URL");
    }
    const removed = await fetch(removeUrl, { method: "DELETE", headers: ownerHeaders });
    assert.equal(removed.status, 204);
    assert.equal(objects.size, 0, "removal deletes both the original and cutout objects");
    const removedCardResponse = await fetch(cardUrl);
    assert.equal(removedCardResponse.status, 200);
    const removedCard = GetAthleteFanCardResponse.parse(await removedCardResponse.json());
    assert.equal(removedCard.photoUrl, null, "removed original photo is absent from public card data");
    assert.equal(removedCard.cutoutUrl, null, "removed cutout is absent from public card data");
    for (const url of previouslyIssuedUrls) {
      assert.equal((await fetch(url)).status, 404, "an old public photo URL no longer returns image content");
      assert.equal((await fetch(url, { headers: ownerHeaders })).status, 404, "the owner cannot load a removed photo");
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});

test("confirming HYPE Card photo replacements retires only superseded images", async (t) => {
  const ownerId = `athlete-photo-replacement-owner-${randomUUID()}`;
  const publicToken = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const originalPath = `/objects/athlete-invite-photos/${randomUUID()}.webp`;
  const oldCutoutPath = `/objects/athlete-invite-photos/${randomUUID()}.webp`;
  const createCutout = async (red: number, green: number, blue: number) => {
    const pixels = Buffer.alloc(4 * 4 * 4);
    for (let y = 1; y < 3; y += 1) {
      for (let x = 1; x < 3; x += 1) {
        const offset = (y * 4 + x) * 4;
        pixels[offset] = red;
        pixels[offset + 1] = green;
        pixels[offset + 2] = blue;
        pixels[offset + 3] = 255;
      }
    }
    return sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).webp().toBuffer();
  };
  const originalBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#d22" } })
    .webp().toBuffer();
  const oldCutoutBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .webp().toBuffer();
  const objects = new Map<string, Buffer>([
    [originalPath, originalBytes],
    [oldCutoutPath, oldCutoutBytes],
  ]);
  let nextSavedPath: string | null = null;

  await db.insert(accountAccessTable).values({
    ownerClerkUserId: ownerId,
    role: "fan",
    accessMode: "full",
    lifecycleStatus: "active",
  });
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
    photoObjectPath: originalPath,
    cutoutObjectPath: oldCutoutPath,
  }).returning();

  t.mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async (objectPath: string) => {
    const bytes = objects.get(objectPath);
    if (!bytes) throw new ObjectNotFoundError();
    return { download: async () => [bytes] } as never;
  });
  t.mock.method(ObjectStorageService.prototype, "getObjectEntityMetadata", async (objectPath: string) => {
    const bytes = objects.get(objectPath);
    if (!bytes) throw new ObjectNotFoundError();
    return { size: bytes.byteLength, contentType: "image/webp" };
  });
  t.mock.method(ObjectStorageService.prototype, "trySetObjectEntityAclPolicy", async (objectPath: string) => objectPath);
  t.mock.method(ObjectStorageService.prototype, "savePrivateObjectEntity", async (contents: Buffer) => {
    nextSavedPath = `/objects/athlete-invite-photos/${randomUUID()}.webp`;
    objects.set(nextSavedPath, contents);
    return nextSavedPath;
  });
  t.mock.method(ObjectStorageService.prototype, "deleteObjectEntity", async (objectPath: string) => {
    if (!objects.delete(objectPath)) throw new ObjectNotFoundError();
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", athleteInviteFeaturesRouter);
  app.use("/api", athleteInvitesRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const inviteUrl = `${origin}/api/athlete-invites/${publicToken}`;
  const cardUrl = `${inviteUrl}/fan`;
  const ownerHeaders = { "x-test-user": ownerId };

  const readCard = async () => GetAthleteFanCardResponse.parse(await (await fetch(cardUrl)).json());
  const uploadAndConfirm = async (contents: Buffer, mediaRole: "photo" | "cutout", sourcePhotoRevision?: string) => {
    const uploadPath = `/objects/athlete-invite-photos/upload-${randomUUID()}.webp`;
    objects.set(uploadPath, contents);
    await db.insert(athleteInvitePhotoUploadClaimsTable).values({
      inviteId: invite.id,
      ownerClerkUserId: ownerId,
      objectPath: uploadPath,
      contentType: "image/webp",
      size: contents.byteLength,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await fetch(`${inviteUrl}/photo`, {
      method: "PUT",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        objectPath: uploadPath,
        mediaRole,
        ...(sourcePhotoRevision ? { sourcePhotoRevision } : {}),
      }),
    });
    const body = await response.json() as { photoUrl?: string; photoRevision?: string; error?: string };
    assert.equal(response.status, 200, `a valid upload claim can be confirmed: ${body.error ?? "no API error detail"}`);
    assert.equal(objects.has(uploadPath), false, "the temporary uploaded object is retired after confirmation");
    return body as { photoUrl: string; photoRevision: string };
  };

  try {
    const initialCard = await readCard();
    assert.ok(initialCard.photoUrl);
    assert.ok(initialCard.cutoutUrl);
    const previousPhotoUrl = new URL(initialCard.photoUrl, origin).toString();
    const previousCutoutUrl = new URL(initialCard.cutoutUrl, origin).toString();

    const newOriginalSource = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "#2d2" },
    }).webp().toBuffer();
    const newOriginal = await uploadAndConfirm(newOriginalSource, "photo");
    assert.equal((await fetch(previousPhotoUrl)).status, 404, "the old original URL is invalid after photo replacement");
    assert.equal((await fetch(previousCutoutUrl)).status, 404, "the old cutout URL is invalid after photo replacement");
    assert.equal(objects.has(originalPath), false, "the replaced original object is deleted");
    assert.equal(objects.has(oldCutoutPath), false, "the cutout derived from the replaced original is deleted");
    const replacementCard = await readCard();
    assert.ok(replacementCard.photoUrl);
    assert.equal(replacementCard.cutoutUrl, null, "replacing an original never leaves a stale cutout attached");
    assert.equal((await fetch(new URL(replacementCard.photoUrl, origin))).status, 200);
    assert.equal(
      Buffer.from(await (await fetch(new URL(replacementCard.photoUrl, origin))).arrayBuffer()).toString("base64"),
      objects.get(nextSavedPath!)!.toString("base64"),
      "the replacement original is served at its current versioned URL",
    );
    const currentOriginalUrl = new URL(replacementCard.photoUrl, origin).toString();
    const currentOriginalPath = nextSavedPath!;

    const firstCutoutSource = await createCutout(30, 100, 220);
    await uploadAndConfirm(firstCutoutSource, "cutout", newOriginal.photoRevision);
    const cardWithCutout = await readCard();
    assert.ok(cardWithCutout.photoUrl);
    assert.ok(cardWithCutout.cutoutUrl);
    const oldCutoutUrl = new URL(cardWithCutout.cutoutUrl, origin).toString();
    const oldCutoutCurrentPath = nextSavedPath!;

    const secondCutoutSource = await createCutout(220, 80, 30);
    await uploadAndConfirm(secondCutoutSource, "cutout", newOriginal.photoRevision);
    const cardWithReplacementCutout = await readCard();
    assert.ok(cardWithReplacementCutout.cutoutUrl);
    assert.equal((await fetch(oldCutoutUrl)).status, 404, "the replaced cutout URL is invalid");
    assert.equal(objects.has(oldCutoutCurrentPath), false, "only the superseded cutout object is deleted");
    assert.equal(objects.has(currentOriginalPath), true, "replacing a cutout preserves the current original object");
    assert.equal(cardWithReplacementCutout.photoUrl, cardWithCutout.photoUrl,
      "the unchanged original retains its versioned URL when only the cutout changes");
    const preservedOriginalResponse = await fetch(currentOriginalUrl);
    assert.equal(preservedOriginalResponse.status, 200, "the current original remains available at its existing URL");
    assert.deepEqual(
      Buffer.from(await preservedOriginalResponse.arrayBuffer()),
      objects.get(currentOriginalPath),
    );
    assert.equal((await fetch(new URL(cardWithReplacementCutout.cutoutUrl, origin))).status, 200,
      "the replacement cutout is served at its current versioned URL");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(athleteInvitePhotoUploadClaimsTable)
      .where(eq(athleteInvitePhotoUploadClaimsTable.inviteId, invite.id));
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});
