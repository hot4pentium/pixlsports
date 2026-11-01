import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { pool } from "@workspace/db";
import { digest } from "../lib/nativeAccountLink";
import { NativeLinkError } from "../lib/nativeIdentity";
import { nativeAthletePhoto } from "../lib/nativeAthletePhoto";
import { nativePhotoStep } from "../lib/nativeAthletePhotoDiagnostics";
import { nativeAccountLinkRouter } from "./nativeAccountLink";

const issuer = "https://native-photo-route-fixture.clerk.accounts.dev";
const subject = `user_photo${randomUUID().replaceAll("-", "")}`;

after(async () => {
  for (const action of ["native-request", "athlete-photo"]) {
    await pool.query("DELETE FROM native_link_rate_limits WHERE key=$1",
      [digest(`${action}:${JSON.stringify({ issuer, subject })}`)]);
  }
  await pool.end();
});

test("native photo HTTP failures log only bounded stages and retain safe 400/409/429/503 responses", async (t) => {
  const originalIssuer = process.env.NATIVE_IOS_CLERK_ISSUER;
  const originalFetch = globalThis.fetch;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = "native-photo-route-fixture";
  process.env.NATIVE_IOS_CLERK_ISSUER = issuer;
  globalThis.fetch = async (input, init) => {
    if (String(input) === `${issuer}/.well-known/jwks.json`) {
      return Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
    }
    return originalFetch(input, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalIssuer === undefined) delete process.env.NATIVE_IOS_CLERK_ISSUER;
    else process.env.NATIVE_IOS_CLERK_ISSUER = originalIssuer;
  });
  const token = await new SignJWT({ sid: "sess_photoRouteFixture" })
    .setProtectedHeader({ alg: "RS256", kid }).setIssuer(issuer).setSubject(subject)
    .setIssuedAt().setExpirationTime("1m").sign(privateKey);
  const sensitive = [
    token, "/private/bucket/private-athlete.webp", "Private Athlete Name", "PRIVATE_IMAGE_BYTES",
    "https://storage.invalid/photo?signature=secret-signature", "postgres://user:secret@private.invalid/db",
  ];
  const logs: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = {
      error: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
    } as unknown as typeof req.log;
    next();
  });
  app.use("/api/native", nativeAccountLinkRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/native/supporter/hype-card/athlete-photo`;
  const headers = {
    authorization: `Bearer ${token}`, "content-type": "image/jpeg",
    "X-Hype-Card-ID": randomUUID(), "X-Photo-Revision": "none",
  };
  const save = t.mock.method(nativeAthletePhoto, "save", () => nativePhotoStep("storage_write", async () => {
    throw Object.assign(new Error(sensitive.join(" ")), {
      headers, metadata: { athleteName: sensitive[2] }, bytes: Buffer.from(sensitive[3]!),
    });
  }));
  const upload = (body: Buffer) => originalFetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
  const failed = await upload(Buffer.from(sensitive[3]!));
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "PIXL Sports is temporarily unavailable. Please try again." });
  assert.deepEqual(logs.pop(), [{
    event: "native_athlete_photo_failure", operation: "save",
    stage: "storage_write", category: "infrastructure", status: 503,
  }, "Native athlete photo operation failed"]);
  save.mock.restore();

  const invalid = await originalFetch(url, {
    method: "PUT", headers: { authorization: headers.authorization, "content-type": "image/jpeg" },
    body: Buffer.from(sensitive[3]!),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /valid athlete photo/);
  const oversized = await upload(Buffer.alloc(5 * 1024 * 1024 + 1, 65));
  assert.equal(oversized.status, 400);
  assert.deepEqual(await oversized.json(), { error: "Choose a valid photo up to 5 MB." });

  for (const [status, stage] of [[409, "revision"], [429, "validation"]] as const) {
    const remove = t.mock.method(nativeAthletePhoto, "remove", () => nativePhotoStep(stage, async () => {
      throw new NativeLinkError(status, "Refresh the photo before trying again.");
    }));
    const response = await originalFetch(url, {
      method: "DELETE", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ cardId: headers["X-Hype-Card-ID"], revision: "none" }),
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Refresh the photo before trying again." });
    if (status === 429) assert.equal(response.headers.get("retry-after"), "600");
    remove.mock.restore();
  }
  assert.equal(logs.length, 4);
  for (const entry of logs) {
    const serialized = JSON.stringify(entry);
    for (const value of sensitive) assert.equal(serialized.includes(value), false);
    assert.ok(serialized.length < 300);
  }
});
