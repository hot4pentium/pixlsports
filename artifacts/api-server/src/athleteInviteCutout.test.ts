import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { InvalidAthleteInvitePhotoError, sanitizeAthleteInvitePhoto } from "./lib/athleteInvitePhoto";

test("cutout confirmation rejects opaque photos and empty transparent images", async () => {
  const opaque = await sharp({ create: { width: 100, height: 100, channels: 4, background: "#335577" } }).png().toBuffer();
  const empty = await sharp({ create: { width: 100, height: 100, channels: 4, background: "#00000000" } }).png().toBuffer();
  await assert.rejects(sanitizeAthleteInvitePhoto(opaque, "image/png", true), InvalidAthleteInvitePhotoError);
  await assert.rejects(sanitizeAthleteInvitePhoto(empty, "image/png", true), InvalidAthleteInvitePhotoError);
  assert.equal((await sanitizeAthleteInvitePhoto(opaque, "image/png")).contentType, "image/webp");
});

test("a cutout retains transparency and loses only empty padding while original bytes stay intact", async () => {
  const subject = await sharp({ create: { width: 40, height: 60, channels: 4, background: "#335577" } }).png().toBuffer();
  const original = await sharp({ create: { width: 100, height: 120, channels: 4, background: "#00000000" } })
    .composite([{ input: subject, top: 30, left: 30 }]).png().toBuffer();
  const before = Buffer.from(original);
  const result = await sanitizeAthleteInvitePhoto(original, "image/png", true);
  const metadata = await sharp(result.contents).metadata();
  assert.ok(metadata.width! <= 42 && metadata.height! <= 62);
  assert.deepEqual(original, before);
});