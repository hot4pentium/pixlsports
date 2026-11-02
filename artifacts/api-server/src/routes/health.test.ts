import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHealthRouter } from "./health";
import type { PhotoStorageReadiness } from "../lib/photoStorageReadiness";

test("API liveness stays available during storage outages and capability responses are not browser-cached", async (t) => {
  let result: PhotoStorageReadiness = { status: "unavailable", reason: "configuration" };
  let calls = 0;
  const app = express();
  app.use("/api", createHealthRouter(async () => { calls++; return result; }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  for (const state of [
    { status: "unavailable", reason: "configuration" },
    { status: "unavailable", reason: "access" },
    { status: "ready" },
  ] as PhotoStorageReadiness[]) {
    result = state;
    const live = await fetch(`${base}/healthz`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
    const capability = await fetch(`${base}/healthz/photo-storage`);
    assert.equal(capability.status, state.status === "ready" ? 200 : 503);
    assert.equal(capability.headers.get("cache-control"), "no-store");
    assert.deepEqual(await capability.json(), state);
  }
  assert.equal(calls, 3, "Liveness never triggers a storage check");
});
