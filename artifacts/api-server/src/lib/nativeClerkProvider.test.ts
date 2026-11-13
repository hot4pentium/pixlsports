import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativeClerkRead, NativeClerkProviderError } from "./nativeClerkProvider";
import {
  assertNativeProviderConnection, createNativeProviderDeletion,
  deleteNativeProviderIdentity, loadNativeSignupIdentity,
} from "./nativeSignupIdentity";

// Deliberately fake fixture values, not actual Clerk credentials.
const liveFixture = "sk_live_nativeProductionFixture";
const issuer = "https://clerk.native-fixture.example";
const who = { issuer, subject: "user_nativeFixture" };
const keys = { keys: [{ kid: "native-fixture", kty: "RSA", n: "native-modulus", e: "AQAB" }] };
const diagnostic = (code: NativeClerkProviderError["diagnosticCode"]) =>
  (error: unknown) => error instanceof NativeClerkProviderError
    && error.status === 503 && error.diagnosticCode === code;

test("development keeps its connector even when a shared production key is present", async () => {
  const calls: unknown[] = [];
  const read = createNativeClerkRead({
    environment: () => ({ NODE_ENV: "development", NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY: liveFixture }),
    proxy: async (path, init) => { calls.push([path, init]); return Response.json(keys); },
    fetchRequest: async () => { assert.fail("Development must not use the production key"); },
  });
  assert.deepEqual(await (await read("/v1/jwks")).json(), keys);
  assert.deepEqual(calls, [["/v1/jwks", { method: "GET" }]]);
});

test("production sends its dedicated live key only to the fixed Clerk Backend API", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const read = createNativeClerkRead({
    environment: () => ({ NODE_ENV: "production", NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY: liveFixture }),
    proxy: async () => { assert.fail("Production must not fall back to the development connector"); },
    fetchRequest: async (url, init) => { calls.push({ url, init }); return Response.json(keys); },
  });
  await read("/v1/jwks");
  await read(`/v1/users/${who.subject}`);
  await read(`/v1/users/${who.subject}`, "DELETE");
  assert.deepEqual(calls.map(c => [c.url, c.init.method]), [
    ["https://api.clerk.com/v1/jwks", "GET"],
    [`https://api.clerk.com/v1/users/${who.subject}`, "GET"],
    [`https://api.clerk.com/v1/users/${who.subject}`, "DELETE"],
  ]);
  for (const { init } of calls) {
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${liveFixture}`);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("missing or test production keys fail closed before either transport is called", async () => {
  for (const value of [undefined, "", "sk_test_wrongInstance", "pk_live_notServerKey", "sk_live_bad\nheader"]) {
    const read = createNativeClerkRead({
      environment: () => ({ NODE_ENV: "production", NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY: value }),
      proxy: async () => { assert.fail("Cannot fall back to PWA/development credentials"); },
      fetchRequest: async () => { assert.fail("Invalid configuration must not make a request"); },
    });
    await assert.rejects(read("/v1/jwks"), diagnostic(value ? "production_key_invalid" : "production_key_missing"));
  }
});

test("a production API rejection is returned without retrying through another instance", async () => {
  const read = createNativeClerkRead({
    environment: () => ({ NODE_ENV: "production", NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY: liveFixture }),
    proxy: async () => { assert.fail("A rejected native key must never use the connector"); },
    fetchRequest: async () => new Response(null, { status: 401 }),
  });
  assert.equal((await read("/v1/jwks")).status, 401);
});

test("provider credentials cannot be sent to an arbitrary URL or unrelated Clerk operation", async () => {
  const read = createNativeClerkRead({
    proxy: async () => { assert.fail("Invalid paths must never reach a provider"); },
    fetchRequest: async () => { assert.fail("Invalid paths must never reach a provider"); },
  });
  for (const path of ["https://evil.example/v1/jwks", "//evil.example", "/v1/users",
    "/v1/users/user_fixture?secret=anything", "/v1/users/user_fixture/../../sessions"]) {
    await assert.rejects(read(path), diagnostic("request_path_invalid"));
  }
  await assert.rejects(read("/v1/jwks", "DELETE"), diagnostic("request_path_invalid"));
});

test("both transports time out, abort production fetch, and sanitize thrown provider errors", async () => {
  for (const NODE_ENV of ["development", "production"]) {
    let signal: AbortSignal | null | undefined;
    const read = createNativeClerkRead({
      environment: () => ({ NODE_ENV, NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY: liveFixture }),
      proxy: async () => new Promise<Response>(() => {}),
      fetchRequest: async (_url, init) => {
        signal = init.signal;
        return new Promise<Response>(() => {});
      },
      timeoutMs: 5,
    });
    await assert.rejects(read("/v1/jwks"), diagnostic("request_timeout"));
    if (NODE_ENV === "production") assert.equal(signal?.aborted, true);
  }
  const read = createNativeClerkRead({
    environment: () => ({ NODE_ENV: "production", NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY: liveFixture }),
    proxy: async () => { assert.fail("No connector fallback"); },
    fetchRequest: async () => { throw new Error(`Sensitive upstream failure ${liveFixture}`); },
  });
  await assert.rejects(read("/v1/jwks"), (error: unknown) => {
    assert.ok(error instanceof NativeClerkProviderError);
    assert.equal(error.diagnosticCode, "request_failed");
    assert.ok(!error.message.includes(liveFixture));
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("the live credential must match the issuer before native identity deletion", async () => {
  const oldIssuer = process.env.NATIVE_IOS_CLERK_ISSUER;
  process.env.NATIVE_IOS_CLERK_ISSUER = issuer;
  const deleted: string[] = [];
  let backend = keys;
  const deps = {
    read: async () => Response.json(backend),
    issuerKeys: async (value: string) => { assert.equal(value, issuer); return Response.json(keys); },
    remove: async (subject: string) => { deleted.push(subject); return new Response(null, { status: 404 }); },
  };
  try {
    await assertNativeProviderConnection(who, deps);
    backend = { keys: [{ ...keys.keys[0], n: "different-instance" }] };
    const remove = createNativeProviderDeletion(deps);
    await assert.rejects(remove(who), diagnostic("instance_mismatch"));
    assert.deepEqual(deleted, []);
    backend = keys;
    await remove(who);
    assert.deepEqual(deleted, [who.subject]);
    await assert.rejects(remove({ ...who, issuer: "https://other-instance.example" }),
      (error: unknown) => error instanceof Error && "status" in error && error.status === 401);
    assert.deepEqual(deleted, [who.subject]);
  } finally {
    if (oldIssuer === undefined) delete process.env.NATIVE_IOS_CLERK_ISSUER;
    else process.env.NATIVE_IOS_CLERK_ISSUER = oldIssuer;
  }
});

test("unavailable and malformed key responses produce only fixed diagnostic codes", async () => {
  const oldIssuer = process.env.NATIVE_IOS_CLERK_ISSUER;
  process.env.NATIVE_IOS_CLERK_ISSUER = issuer;
  const deps = {
    read: async () => new Response(null, { status: 401 }),
    issuerKeys: async () => Response.json(keys),
    remove: async () => { assert.fail("No deletion during verification"); },
  };
  try {
    await assert.rejects(assertNativeProviderConnection(who, deps), diagnostic("backend_keys_unavailable"));
    await assert.rejects(assertNativeProviderConnection(who, {
      ...deps, read: async () => Response.json(keys),
      issuerKeys: async () => new Response(null, { status: 503 }),
    }), diagnostic("issuer_keys_unavailable"));
    await assert.rejects(assertNativeProviderConnection(who, {
      ...deps, read: async () => Response.json({ unexpected: "not signing keys" }),
    }), diagnostic("keys_invalid"));
  } finally {
    if (oldIssuer === undefined) delete process.env.NATIVE_IOS_CLERK_ISSUER;
    else process.env.NATIVE_IOS_CLERK_ISSUER = oldIssuer;
  }
});

test("real production signup and deletion use the native key and verify its instance first", async () => {
  const envKeys = ["NODE_ENV", "NATIVE_IOS_CLERK_ISSUER", "NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY"] as const;
  const previous = envKeys.map(key => process.env[key]);
  const previousFetch = globalThis.fetch;
  const userRequests: string[] = [];
  let backendKeys = keys;
  process.env.NODE_ENV = "production";
  process.env.NATIVE_IOS_CLERK_ISSUER = issuer;
  process.env.NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY = liveFixture;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `${issuer}/.well-known/jwks.json`) {
      assert.equal(new Headers(init?.headers).get("Authorization"), null,
        "Never send the backend secret to the issuer or any other host");
      return Response.json(keys);
    }
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${liveFixture}`);
    if (url === "https://api.clerk.com/v1/jwks") return Response.json(backendKeys);
    assert.equal(url, `https://api.clerk.com/v1/users/${who.subject}`);
    userRequests.push(init?.method ?? "GET");
    if (init?.method === "DELETE") return Response.json({ deleted: true });
    return Response.json({
      id: who.subject, created_at: 12345, banned: false, locked: false,
      primary_email_address_id: "verified",
      email_addresses: [
        { id: "unverified", email_address: "unverified@example.com", verification: { status: "unverified" } },
        { id: "verified", email_address: "native@example.com", verification: { status: "verified" } },
      ],
    });
  };
  try {
    assert.deepEqual(await loadNativeSignupIdentity(who), {
      createdAt: 12345, verifiedEmails: ["native@example.com"],
    });
    backendKeys = { keys: [{ ...keys.keys[0], n: "wrong-instance" }] };
    await assert.rejects(deleteNativeProviderIdentity(who), diagnostic("instance_mismatch"));
    assert.deepEqual(userRequests, ["GET"], "A mismatched key must not reach a user deletion");
    backendKeys = keys;
    await deleteNativeProviderIdentity(who);
    assert.deepEqual(userRequests, ["GET", "DELETE"]);
  } finally {
    globalThis.fetch = previousFetch;
    envKeys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
