import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createRequireAuthOrNativeOwner } from "./requireAuth";
import { NativeLinkError, type NativeIdentity } from "../lib/nativeIdentity";

const identity: NativeIdentity = {
  issuer: "https://ios-issuer.example",
  subject: "user_native_owner",
};

async function requestWithMiddleware(
  middleware: express.RequestHandler,
  token = "native-session",
) {
  const app = express();
  app.use((req, _res, next) => {
    const auth = () => ({ userId: undefined, tokenType: "session_token" });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    (req as express.Request & { auth: typeof auth }).auth = auth;
    next();
  });
  app.post("/", middleware, (_req, res) => {
    res.json({ ownerId: res.locals.clerkUserId });
  });

  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("native owner auth maps only a verified, linked, eligible iPhone account", async () => {
  const checked: string[] = [];
  const middleware = createRequireAuthOrNativeOwner({
    verify: async (token) => {
      assert.equal(token, "native-session");
      return identity;
    },
    findLinkedOwner: async (verifiedIdentity) => {
      assert.deepEqual(verifiedIdentity, identity);
      return "owner_clerk_123";
    },
    assertOwnerEligible: async (ownerId) => { checked.push(`eligible:${ownerId}`); },
    assertNotDeleting: async (verifiedIdentity) => {
      checked.push(`not-deleting:${verifiedIdentity.subject}`);
    },
    rateLimit: async (verifiedIdentity) => {
      checked.push(`rate-limited:${verifiedIdentity.subject}`);
    },
  });

  const response = await requestWithMiddleware(middleware);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ownerId: "owner_clerk_123" });
  assert.deepEqual(checked, [
    "rate-limited:user_native_owner",
    "not-deleting:user_native_owner",
    "eligible:owner_clerk_123",
  ]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("native owner auth rejects a valid but unlinked iPhone account", async () => {
  const middleware = createRequireAuthOrNativeOwner({
    verify: async () => identity,
    findLinkedOwner: async () => null,
    assertOwnerEligible: async () => assert.fail("unlinked owners are not checked"),
    assertNotDeleting: async () => undefined,
    rateLimit: async () => undefined,
  });

  const response = await requestWithMiddleware(middleware);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Connect your PIXL account before starting Live Taps.",
  });
});

test("native owner auth reports rejected iPhone sessions without running owner actions", async () => {
  const middleware = createRequireAuthOrNativeOwner({
    verify: async () => { throw new NativeLinkError(401, "Sign in to the iPhone app again."); },
    findLinkedOwner: async () => assert.fail("rejected identities cannot be looked up"),
    assertOwnerEligible: async () => assert.fail("rejected identities cannot be checked"),
    assertNotDeleting: async () => assert.fail("rejected identities cannot continue"),
    rateLimit: async () => assert.fail("rejected identities cannot be rate limited"),
  });

  const response = await requestWithMiddleware(middleware);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Sign in to the iPhone app again." });
});
