import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { InvalidAthleteInvitePhotoError, sanitizeAthleteInvitePhoto, createAthleteInviteIcon } from "./lib/athleteInvitePhoto";
import { isAllowedPushEndpoint } from "./lib/webPush";

test("athlete invite photo confirmation transcodes supported images and strips metadata", async () => {
  const source = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 20, g: 80, b: 140 } },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const clean = await sanitizeAthleteInvitePhoto(source, "image/jpeg");
  const metadata = await sharp(clean.contents).metadata();
  assert.equal(clean.contentType, "image/webp");
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.width, 3);
  assert.equal(metadata.height, 4);

  await assert.rejects(
    sanitizeAthleteInvitePhoto(Buffer.from("not an image"), "image/png"),
    InvalidAthleteInvitePhotoError,
  );
  await assert.rejects(
    sanitizeAthleteInvitePhoto(source, "image/png"),
    InvalidAthleteInvitePhotoError,
  );
});

test("athlete fan install icons are real exact-size PNGs", async () => {
  for (const size of [192, 512] as const) {
    const bytes = await createAthleteInviteIcon(null, size);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
  }
});

test("push endpoint allowlist admits browser vendors and rejects SSRF targets", () => {
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abcDEF1234567890"), true);
  assert.equal(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abcDEF1234567890"), true);
  assert.equal(isAllowedPushEndpoint("https://web.push.apple.com/abcDEF1234567890"), true);
  assert.equal(isAllowedPushEndpoint("https://wns2-example.notify.windows.com/w/?token=abcDEF1234567890"), true);
  for (const endpoint of [
    "https://push.example.test/token-1234567890",
    "https://127.0.0.1/fcm/send/abcDEF1234567890",
    "https://[::1]/fcm/send/abcDEF1234567890",
    "https://localhost/fcm/send/abcDEF1234567890",
    "https://fcm.googleapis.com.evil.test/fcm/send/abcDEF1234567890",
    "https://user@fcm.googleapis.com/fcm/send/abcDEF1234567890",
    "https://fcm.googleapis.com:8443/fcm/send/abcDEF1234567890",
    "http://fcm.googleapis.com/fcm/send/abcDEF1234567890",
  ]) {
    assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
  }
});