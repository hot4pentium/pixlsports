import assert from "node:assert/strict";
import test from "node:test";
import { getApnsAuthority, getApnsConfig, sendApnsPush } from "./apns";

test("APNs is unavailable until all Apple provider settings are present", () => {
  assert.equal(getApnsConfig({}).available, false);
  assert.equal(getApnsConfig({
    APNS_AUTH_KEY: "private-key",
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
  }).available, false);
  assert.equal(getApnsConfig({
    APNS_AUTH_KEY: "private-key",
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
    APNS_TOPIC: "com.pixlsports",
  }).available, true);
});

test("APNs selects the correct host for development and App Store tokens", () => {
  assert.equal(getApnsAuthority("sandbox"), "https://api.sandbox.push.apple.com");
  assert.equal(getApnsAuthority("production"), "https://api.push.apple.com");
});

test("APNs does not attempt delivery when provider credentials are absent", async () => {
  const result = await sendApnsPush({
    deviceToken: "a".repeat(64),
    environment: "sandbox",
  }, { title: "Game day", body: "Your event is coming up." }, 100, getApnsConfig({}));
  assert.deepEqual(result, {
    configured: false,
    sent: false,
    stale: false,
    failure: "temporary",
  });
});
