import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { eq } from "drizzle-orm";
import express, { type Request } from "express";
import { db, internalJobRequestsTable } from "@workspace/db";
import {
  createGameOnAlertSignature,
  GAME_ON_ALERTS_TRIGGER_PATH,
} from "../lib/gameOnAlertSchedulerAuth";
import { createInternalJobsRouter } from "./internalJobs";

const SECRET = "test-only-game-on-alert-trigger-secret";
const NOW = Date.parse("2026-09-28T12:00:00.000Z");

async function startServer(router: ReturnType<typeof createInternalJobsRouter>) {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }));
  app.use("/api", router);
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}${GAME_ON_ALERTS_TRIGGER_PATH}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function requestHeaders(nonce = randomUUID(), timestamp = String(NOW), secret = SECRET) {
  return {
    "x-game-on-alerts-timestamp": timestamp,
    "x-game-on-alerts-nonce": nonce,
    "x-game-on-alerts-signature": createGameOnAlertSignature(secret, timestamp, nonce),
  };
}

test("internal Game On trigger runs once and rejects a replay", async () => {
  const usedNonces = new Set<string>();
  let runs = 0;
  const server = await startServer(createInternalJobsRouter({
    getSecret: () => SECRET,
    now: () => NOW,
    claimNonce: async (nonce) => {
      if (usedNonces.has(nonce)) return false;
      usedNonces.add(nonce);
      return true;
    },
    runGameOnAlerts: async () => { runs += 1; },
  }));
  const nonce = randomUUID();
  const headers = requestHeaders(nonce);

  try {
    const first = await fetch(server.url, { method: "POST", headers });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { success: true });
    assert.equal(runs, 1);

    const replay = await fetch(server.url, { method: "POST", headers });
    assert.equal(replay.status, 409);
    assert.equal(runs, 1);
  } finally {
    await server.close();
  }
});

test("persisted nonces reject replays across router instances", async () => {
  let runs = 0;
  const nonce = randomUUID();
  const headers = requestHeaders(nonce);
  const firstServer = await startServer(createInternalJobsRouter({
    getSecret: () => SECRET,
    now: () => NOW,
    runGameOnAlerts: async () => { runs += 1; },
  }));
  try {
    const first = await fetch(firstServer.url, { method: "POST", headers });
    assert.equal(first.status, 200);
  } finally {
    await firstServer.close();
  }

  const secondServer = await startServer(createInternalJobsRouter({
    getSecret: () => SECRET,
    now: () => NOW,
    runGameOnAlerts: async () => { runs += 1; },
  }));
  try {
    const replay = await fetch(secondServer.url, { method: "POST", headers });
    assert.equal(replay.status, 409);
    assert.equal(runs, 1);
  } finally {
    await secondServer.close();
    await db.delete(internalJobRequestsTable)
      .where(eq(internalJobRequestsTable.nonce, nonce));
  }
});

test("internal Game On trigger rejects invalid signatures and stale timestamps", async () => {
  let runs = 0;
  const server = await startServer(createInternalJobsRouter({
    getSecret: () => SECRET,
    now: () => NOW,
    claimNonce: async () => true,
    runGameOnAlerts: async () => { runs += 1; },
  }));

  try {
    const invalid = await fetch(server.url, {
      method: "POST",
      headers: { ...requestHeaders(), "x-game-on-alerts-signature": "0".repeat(64) },
    });
    assert.equal(invalid.status, 401);

    const staleTimestamp = String(NOW - 120_000);
    const stale = await fetch(server.url, {
      method: "POST",
      headers: requestHeaders(randomUUID(), staleTimestamp),
    });
    assert.equal(stale.status, 401);
    assert.equal(runs, 0);
  } finally {
    await server.close();
  }
});

test("internal Game On trigger requires configuration and rejects bodies or queries", async () => {
  const unconfigured = await startServer(createInternalJobsRouter({
    getSecret: () => undefined,
    now: () => NOW,
    runGameOnAlerts: async () => assert.fail("must not run without configuration"),
  }));
  try {
    const response = await fetch(unconfigured.url, { method: "POST" });
    assert.equal(response.status, 503);
  } finally {
    await unconfigured.close();
  }

  let runs = 0;
  const server = await startServer(createInternalJobsRouter({
    getSecret: () => SECRET,
    now: () => NOW,
    claimNonce: async () => true,
    runGameOnAlerts: async () => { runs += 1; },
  }));
  try {
    const withQuery = await fetch(`${server.url}?run=1`, {
      method: "POST",
      headers: requestHeaders(),
    });
    assert.equal(withQuery.status, 400);

    const withBody = await fetch(server.url, {
      method: "POST",
      headers: { ...requestHeaders(), "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(withBody.status, 400);
    assert.equal(runs, 0);
  } finally {
    await server.close();
  }
});

test("cron-job.org trigger accepts a fresh token request once and rejects stale or altered requests", async () => {
  const usedNonces = new Set<string>();
  let runs = 0;
  const server = await startServer(createInternalJobsRouter({
    getSecret: () => undefined,
    getCronToken: () => SECRET,
    now: () => NOW,
    claimNonce: async (nonce) => {
      if (usedNonces.has(nonce)) return false;
      usedNonces.add(nonce);
      return true;
    },
    runGameOnAlerts: async () => { runs += 1; },
  }));
  const headers = {
    "x-game-on-alerts-timestamp": String(Math.floor(NOW / 1000)),
    "x-game-on-alerts-nonce": randomUUID(),
    "x-game-on-alerts-token": SECRET,
  };
  const url = `${server.url}/cron`;

  try {
    const first = await fetch(url, { method: "POST", headers });
    assert.equal(first.status, 200);
    assert.equal(runs, 1);

    const replay = await fetch(url, { method: "POST", headers });
    assert.equal(replay.status, 409);
    const wrongToken = await fetch(url, {
      method: "POST",
      headers: { ...headers, "x-game-on-alerts-nonce": randomUUID(), "x-game-on-alerts-token": "x".repeat(SECRET.length) },
    });
    assert.equal(wrongToken.status, 401);
    const stale = await fetch(url, {
      method: "POST",
      headers: { ...headers, "x-game-on-alerts-nonce": randomUUID(), "x-game-on-alerts-timestamp": String(Math.floor(NOW / 1000) - 120) },
    });
    assert.equal(stale.status, 401);
    const withBody = await fetch(url, {
      method: "POST",
      headers: { ...headers, "x-game-on-alerts-nonce": randomUUID(), "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(withBody.status, 400);
    const withQuery = await fetch(`${url}?run=1`, {
      method: "POST",
      headers: { ...headers, "x-game-on-alerts-nonce": randomUUID() },
    });
    assert.equal(withQuery.status, 400);
    const hmacUnavailable = await fetch(server.url, { method: "POST", headers });
    assert.equal(hmacUnavailable.status, 503);
    assert.equal(runs, 1);
  } finally {
    await server.close();
  }
});

test("cron-job.org trigger stays off without a dedicated production token", async () => {
  const server = await startServer(createInternalJobsRouter({
    getCronToken: () => undefined,
    runGameOnAlerts: async () => assert.fail("must not run without configuration"),
  }));
  try {
    const response = await fetch(`${server.url}/cron`, { method: "POST" });
    assert.equal(response.status, 503);
  } finally {
    await server.close();
  }
});