import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { nativeIssuer, verifyNativeIdentity } from "./nativeIdentity";

const issuer = "https://native-link-fixture.clerk.accounts.dev";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: ReturnType<typeof createLocalJWKSet>;
before(async () => {
  keys = await generateKeyPair("RS256");
  const publicKey = await exportJWK(keys.publicKey);
  resolver = createLocalJWKSet({ keys: [{ ...publicKey, kid: "fixture" }] });
});
async function token(options: { issuer?: string; sub?: string; sid?: string | null; exp?: number; iat?: number; sts?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    ...(options.sid === null ? {} : { sid: options.sid ?? "sess_nativeFixture" }),
    ...(options.sts ? { sts: options.sts } : {}),
  }).setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer(options.issuer ?? issuer).setSubject(options.sub ?? "user_nativeFixture")
    .setIssuedAt(options.iat ?? now).setExpirationTime(options.exp ?? now + 60).sign(keys.privateKey);
}
test("native verifier accepts only a signed, short-lived native session", async () => {
  assert.deepEqual(await verifyNativeIdentity(await token(), issuer, resolver),
    { issuer, subject: "user_nativeFixture" });
});
test("PWA issuer, expired, missing-session, pending-session and long-lived JWTs are rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const options of [
    { issuer: "https://managed-pwa.accounts.dev" },
    { iat: now - 100, exp: now - 20 }, { sid: null },
    { exp: now + 3600 }, { sub: "not-a-clerk-user" }, { sts: "pending" },
  ]) {
    await assert.rejects(verifyNativeIdentity(await token(options), issuer, resolver),
      (error: any) => error.status === 401);
  }
});
test("unsigned/tampered tokens cannot choose their own trusted JWKS", async () => {
  const signed = await token();
  const parts = signed.split(".");
  parts[1] = Buffer.from(JSON.stringify({ iss: issuer, sub: "user_attacker", sid: "sess_attacker" })).toString("base64url");
  await assert.rejects(verifyNativeIdentity(parts.join("."), issuer, resolver), (e: any) => e.status === 401);
  await assert.rejects(verifyNativeIdentity("not.a.token", issuer, resolver), (e: any) => e.status === 401);
});
test("trusted issuer configuration fails closed and never accepts paths, credentials, or HTTP", () => {
  assert.equal(nativeIssuer(`${issuer}/`), issuer);
  for (const value of ["", "http://localhost", `${issuer}/path`, `${issuer}?issuer=evil`,
    "https://user:password@example.com", "https://example.com:444"]) {
    assert.throws(() => nativeIssuer(value), (e: any) => e.status === 503);
  }
});
