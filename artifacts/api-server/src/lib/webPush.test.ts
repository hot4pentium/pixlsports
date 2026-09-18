import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getWebPushConfig, validatePushNotificationPayload } from "./webPush";

const original = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT,
};

afterEach(() => {
  process.env.VAPID_PUBLIC_KEY = original.publicKey;
  process.env.VAPID_PRIVATE_KEY = original.privateKey;
  process.env.VAPID_SUBJECT = original.subject;
});

describe("web push configuration", () => {
  it("reports unavailable when any VAPID setting is missing", () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    assert.equal(getWebPushConfig().available, false);
  });

  it("rejects oversized notification payloads", () => {
    assert.throws(() => validatePushNotificationPayload({
      title: "Pixl Sports",
      body: "x".repeat(5000),
    }), /4096 bytes/);
  });

  it("serializes a valid notification payload", () => {
    assert.match(validatePushNotificationPayload({
      title: "Pixl Sports",
      body: "A reply is waiting.",
    }), /A reply is waiting/);
  });
});