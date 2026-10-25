import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  assertLinkableWebAccount, createNativeAccountLinkService, digest,
  limitNativeLinkAction, verifierChallenge,
} from "./nativeAccountLink";
import type { NativeIdentity } from "./nativeIdentity";

const service = createNativeAccountLinkService();
const nativeSubjects: string[] = [];
const owners: string[] = [];
const limitKeys: string[] = [];
const errorStatus = (status: number) => (error: any) => error.status === status;
function identity(): NativeIdentity {
  const subject = `user_nativeTest${randomUUID().replaceAll("-", "")}`;
  nativeSubjects.push(subject);
  return { issuer: "https://native-fixture.clerk.accounts.dev", subject };
}
async function owner(status = "active") {
  const id = `user_webTest${randomUUID().replaceAll("-", "")}`;
  owners.push(id);
  await pool.query(`INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free',$2)`, [id, status]);
  return id;
}
async function attempt(who = identity()) {
  const verifier = randomBytes(32).toString("base64url");
  const state = await service.start(who, verifierChallenge(verifier));
  assert.ok(state.requestId);
  assert.ok(state.userCode);
  return { who, verifier, id: state.requestId, code: state.userCode, state };
}
after(async () => {
  await pool.query("DELETE FROM native_link_requests WHERE native_subject=ANY($1::text[])", [nativeSubjects]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [nativeSubjects]);
  await pool.query("DELETE FROM native_link_rate_limits WHERE key=ANY($1::text[])", [limitKeys]);
  await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

test("code is short-lived, hashed at rest, and URLs contain no code or device proof", async () => {
  const a = await attempt();
  assert.match(a.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const { rows } = await pool.query("SELECT * FROM native_link_requests WHERE id=$1", [a.id]);
  assert.equal(rows[0].code_hash, digest(a.code.replaceAll("-", "")));
  assert.equal(rows[0].code_challenge, verifierChallenge(a.verifier));
  assert.ok(rows[0].expires_at.getTime() - Date.now() <= 600000);
  assert.ok(rows[0].expires_at.getTime() > Date.now() + 590000);
  const address = new URL(a.state.verificationUrl!);
  assert.equal(address.pathname, "/connect/iphone");
  assert.equal(address.search, "");
  assert.equal(address.hash, "");
  assert.equal(JSON.stringify(rows[0]).includes(a.verifier), false);
  assert.equal((await service.current(a.who)).status, "unlinked");
});
test("web approval and explicit device confirmation are both required; retries are idempotent", async () => {
  const a = await attempt();
  const web = await owner();
  await assert.rejects(service.complete(a.who, a.id, a.verifier), errorStatus(409));
  assert.equal((await service.preview(web, a.code.toLowerCase())).status, "pending");
  assert.equal((await service.current(a.who)).status, "unlinked");
  await service.decide(web, a.id, a.code, "approve", "Parent · p…@example.com");
  assert.equal((await service.current(a.who)).status, "unlinked");
  assert.equal((await service.webCurrent(web)).status, "approved");
  const approved = await service.poll(a.who, a.id, a.verifier);
  assert.equal(approved.status, "approved");
  assert.equal(approved.accountLabel, "Parent · p…@example.com");
  const [first, retry] = await Promise.all([
    service.complete(a.who, a.id, a.verifier), service.complete(a.who, a.id, a.verifier),
  ]);
  assert.equal(first.status, "linked");
  assert.equal(first.linkId, retry.linkId);
  assert.equal((await service.webCurrent(web)).status, "linked");
  assert.equal((await service.poll(a.who, a.id, a.verifier)).status, "completed");
});
test("another identity, wrong verifier, wrong code, and another owner cannot take over an attempt", async () => {
  const a = await attempt();
  const web = await owner();
  const other = await owner();
  await assert.rejects(service.poll(identity(), a.id, a.verifier), errorStatus(404));
  await assert.rejects(service.poll(a.who, a.id, randomBytes(32).toString("base64url")), errorStatus(404));
  await assert.rejects(service.decide(web, a.id, "AAAAAAAA", "approve", "Wrong"), errorStatus(404));
  await service.decide(web, a.id, a.code, "approve", "Parent");
  await assert.rejects(service.decide(other, a.id, a.code, "approve", "Other parent"), errorStatus(409));
  await assert.rejects(service.preview(other, a.code), errorStatus(404));
});
test("concurrent completion cannot replace an existing web or native link", async () => {
  const [a, b] = await Promise.all([attempt(), attempt()]);
  const web = await owner();
  await service.decide(web, a.id, a.code, "approve", "Parent");
  await service.decide(web, b.id, b.code, "approve", "Parent");
  const outcomes = await Promise.allSettled([
    service.complete(a.who, a.id, a.verifier), service.complete(b.who, b.id, b.verifier),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const failed = outcomes.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(failed.reason.status, 409);
  const { rows } = await pool.query("SELECT * FROM native_account_links WHERE owner_clerk_user_id=$1", [web]);
  assert.equal(rows.length, 1);
});
test("disconnect from either side is immediate, preserves accounts, and prevents replay resurrection", async () => {
  for (const side of ["web", "native"]) {
    const a = await attempt();
    const web = await owner();
    await service.decide(web, a.id, a.code, "approve", "Parent");
    await service.complete(a.who, a.id, a.verifier);
    await service.disconnect(side === "web" ? web : a.who);
    assert.equal((await service.current(a.who)).status, "unlinked");
    assert.equal((await service.webCurrent(web)).status, "unlinked");
    await assert.rejects(service.complete(a.who, a.id, a.verifier), errorStatus(410));
    assert.equal((await service.poll(a.who, a.id, a.verifier)).status, "cancelled");
    assert.equal((await pool.query("SELECT id FROM account_access WHERE owner_clerk_user_id=$1", [web])).rowCount, 1);
  }
});
test("expired, denied, cancelled, restarted and revoked approvals cannot complete", async () => {
  for (const action of ["expire", "deny", "cancel", "restart", "revoke"]) {
    const a = await attempt();
    const web = await owner();
    await service.decide(web, a.id, a.code, action === "deny" ? "deny" : "approve", "Parent");
    if (action === "expire") await pool.query("UPDATE native_link_requests SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [a.id]);
    if (action === "cancel") await service.cancel(a.who, a.id, a.verifier);
    if (action === "restart") await attempt(a.who);
    if (action === "revoke") await service.disconnect(web);
    await assert.rejects(service.complete(a.who, a.id, a.verifier), errorStatus(action === "expire" ? 410 : 409));
    assert.equal((await service.current(a.who)).status, "unlinked");
  }
});
test("inactive, suspended or unprovisioned owners cannot approve, and status is rechecked on completion", async () => {
  const a = await attempt();
  for (const status of ["paused", "cancelled", "deletion_pending"]) {
    await assert.rejects(service.preview(await owner(status), a.code), errorStatus(423));
  }
  await assert.rejects(assertLinkableWebAccount(`user_missing${randomUUID()}`), errorStatus(423));
  const suspended = await owner();
  await pool.query("UPDATE account_access SET admin_suspended_at=NOW() WHERE owner_clerk_user_id=$1", [suspended]);
  await assert.rejects(service.preview(suspended, a.code), errorStatus(423));
  const web = await owner();
  await service.decide(web, a.id, a.code, "approve", "Parent");
  await pool.query("UPDATE account_access SET lifecycle_status='cancelled' WHERE owner_clerk_user_id=$1", [web]);
  await assert.rejects(service.complete(a.who, a.id, a.verifier), errorStatus(423));
});
test("durable rate limits count attempts atomically across concurrent callers", async () => {
  const actor = randomUUID();
  limitKeys.push(digest(`fixture:${actor}`));
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => limitNativeLinkAction(actor, "fixture", 3)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
  for (const result of results) {
    if (result.status === "rejected") assert.equal(result.reason.status, 429);
  }
});
