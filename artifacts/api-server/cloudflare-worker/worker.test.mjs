import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { isValidGameOnAlertSignature } from "../src/lib/gameOnAlertSchedulerAuth.ts";
import { runGameOnAlertTrigger } from "./worker.mjs";

const endpoint = "https://league-matrix-creative-studio.replit.app/api/internal/jobs/game-on-alerts";
const secret = "test-only-game-on-alert-trigger-secret";
const now = 1_790_596_800_000;
const nonce = "68205080-45f3-4ee1-a37f-7e0b52699608";
const environment = {
  GAME_ON_ALERTS_TRIGGER_URL: endpoint,
  GAME_ON_ALERTS_TRIGGER_SECRET: secret,
};

test("Cloudflare caller signs the same request the API accepts", async () => {
  let request;
  await runGameOnAlertTrigger(environment, {
    now: () => now,
    nonce: () => nonce,
    fetchImpl: async (url, init) => {
      request = { url: String(url), ...init };
      return { ok: true, status: 200 };
    },
  });

  const payload = ["v1", "POST", "/api/internal/jobs/game-on-alerts", String(now), nonce].join("\n");
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");
  assert.equal(request.url, endpoint);
  assert.equal(request.method, "POST");
  assert.equal(request.redirect, "error");
  assert.equal(request.body, undefined);
  assert.equal(request.headers["x-game-on-alerts-timestamp"], String(now));
  assert.equal(request.headers["x-game-on-alerts-nonce"], nonce);
  assert.equal(request.headers["x-game-on-alerts-signature"], expectedSignature);
  assert.equal(isValidGameOnAlertSignature({
    timestamp: request.headers["x-game-on-alerts-timestamp"],
    nonce: request.headers["x-game-on-alerts-nonce"],
    signature: request.headers["x-game-on-alerts-signature"],
  }, secret, now), true);
});

test("Cloudflare caller refuses development URLs and short secrets", async () => {
  await assert.rejects(
    runGameOnAlertTrigger({
      ...environment,
      GAME_ON_ALERTS_TRIGGER_URL: "https://preview.replit.dev/api/internal/jobs/game-on-alerts",
    }),
    /published HTTPS endpoint/,
  );
  await assert.rejects(
    runGameOnAlertTrigger({
      ...environment,
      GAME_ON_ALERTS_TRIGGER_SECRET: "short",
    }),
    /secret is not configured/,
  );
});

test("Cloudflare caller reports API failures by status without exposing the secret", async () => {
  await assert.rejects(
    runGameOnAlertTrigger(environment, {
      now: () => now,
      nonce: () => nonce,
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    (error) => error.message === "Game On reminder trigger returned HTTP 401."
      && !error.message.includes(secret),
  );
});