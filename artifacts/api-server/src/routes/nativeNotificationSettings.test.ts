import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import express from "express";
import { pool } from "@workspace/db";
import { digest } from "../lib/nativeAccountLink";
import { nativeAccountLinkRouter } from "./nativeAccountLink";
import { previewNativeAccountDeletion, requestNativeAccountDeletion } from "../lib/nativeAccountDeletion";

const issuer = "https://native-notification-fixture.clerk.accounts.dev";
const ownerClerkUserId = `native-notification-owner-${randomUUID()}`;
const nativeSubject = `user_native${randomUUID().replaceAll("-", "")}`;
const deviceIds = [randomUUID(), randomUUID()];
const deviceTokens = [randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
  randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")];
const originalEnvironment = {
  issuer: process.env.NATIVE_IOS_CLERK_ISSUER,
  apnsAuthKey: process.env.APNS_AUTH_KEY,
  apnsKeyId: process.env.APNS_KEY_ID,
  apnsTeamId: process.env.APNS_TEAM_ID,
  apnsTopic: process.env.APNS_TOPIC,
};
const originalFetch = globalThis.fetch;
let privateKey: CryptoKey;

before(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const publicKey = await exportJWK(keys.publicKey);
  const jwks = JSON.stringify({
    keys: [{ ...publicKey, kid: "native-notification-fixture", alg: "RS256", use: "sig" }],
  });
  process.env.NATIVE_IOS_CLERK_ISSUER = issuer;
  process.env.APNS_AUTH_KEY = "test-key";
  process.env.APNS_KEY_ID = "TESTKEY123";
  process.env.APNS_TEAM_ID = "TESTTEAM123";
  process.env.APNS_TOPIC = "com.pixlsports";
  globalThis.fetch = async (input, init) => {
    if (String(input) === `${issuer}/.well-known/jwks.json`) {
      return new Response(jwks, { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, init);
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    NATIVE_IOS_CLERK_ISSUER: originalEnvironment.issuer,
    APNS_AUTH_KEY: originalEnvironment.apnsAuthKey,
    APNS_KEY_ID: originalEnvironment.apnsKeyId,
    APNS_TEAM_ID: originalEnvironment.apnsTeamId,
    APNS_TOPIC: originalEnvironment.apnsTopic,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await pool.query("DELETE FROM native_push_subscriptions WHERE owner_clerk_user_id=$1", [ownerClerkUserId]);
  await pool.query("DELETE FROM planner_notification_preferences WHERE owner_clerk_user_id=$1", [ownerClerkUserId]);
  await pool.query("DELETE FROM game_on_reminder_sync WHERE key=$1", [`owner:${ownerClerkUserId}`]);
  await pool.query("DELETE FROM native_account_links WHERE owner_clerk_user_id=$1", [ownerClerkUserId]);
  await pool.query("DELETE FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2", [issuer, nativeSubject]);
  await pool.query("DELETE FROM native_link_rate_limits WHERE key=$1", [
    digest(`native-request:${JSON.stringify({ issuer, subject: nativeSubject })}`),
  ]);
  await pool.end();
});

test("account removal HTTP boundary requires native auth, explicit confirmation and the current identity's target", async () => {
  const who = { issuer, subject: nativeSubject };
  const link = await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES($1,$2,$3,'Deletion route fixture') RETURNING id`, [issuer, nativeSubject, ownerClerkUserId]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api/native", nativeAccountLinkRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/native`;
    const token = await sessionToken("sess_nativeDelete");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const noToken = await originalFetch(`${url}/account/deletion`, { headers: { cookie: "__session=not-native-auth" } });
    assert.equal(noToken.status, 401);
    const now = Math.floor(Date.now() / 1000);
    const pwaToken = await new SignJWT({ sid: "sess_web" })
      .setProtectedHeader({ alg: "RS256", kid: "native-notification-fixture" })
      .setIssuer("https://web-fixture.clerk.accounts.dev").setSubject(nativeSubject)
      .setIssuedAt(now).setExpirationTime(now + 60).sign(privateKey);
    assert.equal((await originalFetch(`${url}/account/deletion`, {
      headers: { authorization: `Bearer ${pwaToken}` },
    })).status, 401);
    const preview = await (await originalFetch(`${url}/account/deletion`, { headers })).json();
    assert.equal(preview.target, link.rows[0].id);
    assert.equal(preview.status, "not_requested");
    assert.equal(preview.supportReference, null);
    assert.equal((await pool.query("SELECT 1 FROM native_account_deletions WHERE native_subject=$1", [nativeSubject])).rowCount, 0);
    for (const body of [
      { scope: preview.scope, target: preview.target },
      { scope: preview.scope, target: preview.target, confirmation: "DELETE", ownerId: "someone-else" },
    ]) {
      assert.equal((await originalFetch(`${url}/account/deletion`, { method: "POST", headers, body: JSON.stringify(body) })).status, 400);
    }
    assert.equal((await originalFetch(`${url}/account/deletion`, {
      method: "POST", headers, body: JSON.stringify({ scope: preview.scope, target: randomUUID(), confirmation: "DELETE" }),
    })).status, 409);
    const otherToken = await new SignJWT({ sid: "sess_other" })
      .setProtectedHeader({ alg: "RS256", kid: "native-notification-fixture" })
      .setIssuer(issuer).setSubject(`user_other${randomUUID().replaceAll("-", "")}`)
      .setIssuedAt(now).setExpirationTime(now + 60).sign(privateKey);
    assert.equal((await originalFetch(`${url}/account/deletion`, {
      method: "POST", headers: { ...headers, authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ scope: preview.scope, target: preview.target, confirmation: "DELETE" }),
    })).status, 409);
    const receipt = await requestNativeAccountDeletion(who, await previewNativeAccountDeletion(who),
      async () => ({ verifiedEmails: ["native-notification@example.com"] }));
    const reference = receipt.supportReference;
    const otherHeaders = { ...headers, authorization: `Bearer ${otherToken}` };
    // Knowing the reference does not expose the request, even as a query parameter.
    const otherPreview = await (await originalFetch(`${url}/account/deletion?supportReference=${reference}`, {
      headers: otherHeaders,
    })).json();
    assert.equal(otherPreview.status, "not_requested");
    assert.equal(otherPreview.supportReference, null);
    assert.notEqual(otherPreview.target, preview.target);
    for (const foreignHeaders of [headers, otherHeaders, { "content-type": "application/json" }]) {
      const response = await originalFetch(`${url}/account/deletion`, {
        method: "POST", headers: foreignHeaders,
        body: JSON.stringify({ scope: preview.scope, target: preview.target, confirmation: "DELETE", supportReference: reference }),
      });
      assert.equal(response.status, "authorization" in foreignHeaders ? 400 : 401);
    }
    assert.equal((await originalFetch(`${url}/account/deletion`, {
      method: "POST", headers: otherHeaders,
      body: JSON.stringify({ scope: preview.scope, target: reference, confirmation: "DELETE" }),
    })).status, 409);
    assert.equal((await originalFetch(`${url}/account/deletion?supportReference=${reference}`)).status, 401);
    for (const [path, method, body] of [
      ["/supporter/account", "POST", "{}"],
      ["/notifications/preferences", "GET", undefined],
      ["/notifications/subscriptions", "POST", JSON.stringify({ deviceId: deviceIds[0], deviceToken: deviceTokens[0], environment: "sandbox" })],
    ] as const) {
      assert.equal((await originalFetch(`${url}${path}`, { method, headers, body })).status, 423);
    }
    const pending = await (await originalFetch(`${url}/account/deletion`, { headers })).json();
    assert.equal(pending.status, "pending");
    assert.equal(pending.supportReference, reference);
    // Simulate the already-verified worker's completion. A short-lived JWT
    // retry is still accepted without creating work or contacting a provider.
    await pool.query("UPDATE native_account_deletions SET completed_at=NOW() WHERE native_subject=$1", [nativeSubject]);
    const repeated = await originalFetch(`${url}/account/deletion`, {
      method: "POST", headers,
      body: JSON.stringify({ scope: preview.scope, target: preview.target, confirmation: "DELETE" }),
    });
    assert.equal(repeated.status, 202);
    assert.deepEqual(await repeated.json(), receipt);
  } finally {
    await pool.query("DELETE FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2", [issuer, nativeSubject]);
    await pool.query("DELETE FROM native_account_links WHERE native_issuer=$1 AND native_subject=$2", [issuer, nativeSubject]);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

async function sessionToken(sessionId: string) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "RS256", kid: "native-notification-fixture" })
    .setIssuer(issuer)
    .setSubject(nativeSubject)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(privateKey);
}

test("linked iPhone sessions reload shared preferences and unregister only their own delivery target", async () => {
  await pool.query(
    `INSERT INTO native_account_links (native_issuer,native_subject,owner_clerk_user_id,account_label)
     VALUES ($1,$2,$3,$4)`,
    [issuer, nativeSubject, ownerClerkUserId, "Test PIXL account"],
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api/native", nativeAccountLinkRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const firstToken = await sessionToken("sess_nativeFirst");
    const secondToken = await sessionToken("sess_nativeSecond");
    const request = async (token: string, path: string, init: RequestInit = {}) =>
      originalFetch(`http://127.0.0.1:${address.port}/api/native${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    const readPreferences = async (token: string) => {
      const response = await request(token, "/notifications/preferences");
      assert.equal(response.status, 200);
      return response.json();
    };

    assert.deepEqual(await readPreferences(firstToken), {
      oneHourBefore: false,
      dayOf: false,
      timezone: null,
    });
    const saved = await request(firstToken, "/notifications/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        oneHourBefore: true,
        dayOf: true,
        timezone: "America/Los_Angeles",
      }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), {
      oneHourBefore: true,
      dayOf: true,
      timezone: "America/Los_Angeles",
    });
    assert.deepEqual(await readPreferences(secondToken), {
      oneHourBefore: true,
      dayOf: true,
      timezone: "America/Los_Angeles",
    });

    for (let index = 0; index < deviceIds.length; index += 1) {
      const response = await request(index === 0 ? firstToken : secondToken, "/notifications/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          deviceId: deviceIds[index],
          deviceToken: deviceTokens[index],
          environment: "sandbox",
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { enabled: true });
    }

    const removeFirstDevice = await request(firstToken, "/notifications/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ deviceId: deviceIds[0], environment: "sandbox" }),
    });
    assert.equal(removeFirstDevice.status, 200);
    assert.deepEqual(await removeFirstDevice.json(), { enabled: false });

    const unlink = await request(secondToken, "/link", { method: "DELETE" });
    assert.equal(unlink.status, 200);
    assert.deepEqual(await unlink.json(), { status: "unlinked" });

    const secondDeviceStatus = await request(secondToken,
      `/notifications/subscriptions?deviceId=${deviceIds[1]}&environment=sandbox`);
    assert.equal(secondDeviceStatus.status, 200);
    assert.deepEqual(await secondDeviceStatus.json(), { enabled: false, available: true });

    const preferencesAfterUnlink = await request(secondToken, "/notifications/preferences");
    assert.equal(preferencesAfterUnlink.status, 409);
    const remaining = await pool.query(
      "SELECT id FROM native_push_subscriptions WHERE owner_clerk_user_id=$1",
      [ownerClerkUserId],
    );
    assert.equal(remaining.rowCount, 0);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
    }
  }
});
