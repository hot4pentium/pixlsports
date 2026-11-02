import test from "node:test";
import assert from "node:assert/strict";
import { privatePhotoStorageLocation } from "./photoStorageConfig";
import { createPhotoStorageReadiness } from "./photoStorageReadiness";

const env = { PRIVATE_OBJECT_DIR: "/fixture-bucket/private" };
const configuration = () => privatePhotoStorageLocation(env);

test("private storage config rejects missing, malformed, or publicly served directories without exposing values", () => {
  for (const PRIVATE_OBJECT_DIR of [undefined, "", "   ", "/", "/secret-bucket", "/secret-bucket/../private", "/secret-bucket//private", "https://sensitive.example/private"]) {
    assert.throws(() => privatePhotoStorageLocation({ PRIVATE_OBJECT_DIR }), {
      message: "Private photo storage configuration is missing or invalid.",
    });
  }
  assert.throws(() => privatePhotoStorageLocation({ ...env, PUBLIC_OBJECT_SEARCH_PATHS: "/fixture-bucket" }));
  assert.throws(() => privatePhotoStorageLocation({ ...env, PUBLIC_OBJECT_SEARCH_PATHS: "/fixture-bucket/private/photos" }));
  assert.doesNotThrow(() => privatePhotoStorageLocation({ PRIVATE_OBJECT_DIR: "/fixture-bucket/.private" }));
  assert.deepEqual(configuration(), { dir: "/fixture-bucket/private", bucketName: "fixture-bucket", prefix: "private/" });
  assert.doesNotThrow(() => privatePhotoStorageLocation({ ...env, PUBLIC_OBJECT_SEARCH_PATHS: "/fixture-bucket/public" }));
});

test("missing configuration fails before storage access", async () => {
  let calls = 0;
  const check = createPhotoStorageReadiness({
    configuration: () => privatePhotoStorageLocation({}),
    probe: async () => { calls++; },
  });
  assert.deepEqual(await check(), { status: "unavailable", reason: "configuration" });
  assert.equal(calls, 0);
});

test("read-only readiness caches and coalesces both access failures and successes, then recovers", async () => {
  let clock = 0;
  let calls = 0;
  let fails = true;
  const check = createPhotoStorageReadiness({
    configuration, now: () => clock, ttlMs: 30,
    probe: async () => { calls++; if (fails) throw new Error("credential/private/path"); },
  });
  const results = await Promise.all([check(), check(), check()]);
  assert.deepEqual(results, Array(3).fill({ status: "unavailable", reason: "access" }));
  assert.equal(calls, 1);
  fails = false;
  await check();
  assert.equal(calls, 1);
  clock = 31;
  assert.deepEqual(await check(), { status: "ready" });
  await check();
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(results).includes("credential"));
});

test("stalled access fails within a bounded time", async () => {
  const check = createPhotoStorageReadiness({ configuration, timeoutMs: 5, probe: () => new Promise(() => {}) });
  assert.deepEqual(await check(), { status: "unavailable", reason: "access" });
});

test("configuration is revalidated even while an access success is cached", async () => {
  let configured = true;
  const check = createPhotoStorageReadiness({
    configuration: () => privatePhotoStorageLocation(configured ? env : {}),
    probe: async () => {},
  });
  assert.deepEqual(await check(), { status: "ready" });
  configured = false;
  assert.deepEqual(await check(), { status: "unavailable", reason: "configuration" });
});
