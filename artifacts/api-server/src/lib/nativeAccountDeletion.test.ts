import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import { assertNativeNotDeleting, previewNativeAccountDeletion, requestNativeAccountDeletion } from "./nativeAccountDeletion";
import { createNativeAccountPreparation, nativeSignupExternalId } from "./nativeAccountPreparation";
import { createNativeAccountLinkService } from "./nativeAccountLink";
import { createNativeSupporterProfileService } from "./nativeSupporterProfile";
import { cancelAccount, reactivateAccount, resumeAccount } from "./accountLifecycle";
import { runNativeAccountDeletions } from "../jobs/nativeAccountDeletions";
import { runExpiredAccountPurge } from "../jobs/purgeCancelledAccounts";
import { createNativeProviderDeletion } from "./nativeSignupIdentity";

type Fixture = {
  who: { issuer: string; subject: string };
  owner: string;
  prepare: ReturnType<typeof createNativeAccountPreparation>;
};
const fixtures: Fixture[] = [];
function fixture(): Fixture {
  const who = { issuer: "https://native-delete-fixture.clerk.accounts.dev", subject: `user_delete${randomUUID().replaceAll("-", "")}` };
  const owner = nativeSignupExternalId(who);
  const prepare = createNativeAccountPreparation({
    loadIdentity: async () => ({ createdAt: Date.now(), verifiedEmails: ["native-delete@example.com"] }),
    findOwners: async () => [],
  });
  const f = { who, owner, prepare };
  fixtures.push(f);
  return f;
}

after(async () => {
  for (const f of fixtures) {
    const owners = [f.owner, `legacy-${f.owner}`];
    for (const owner of owners) {
      for (const table of ["native_push_subscriptions", "supporter_photos", "supporter_photo_upload_claims",
        "athlete_invites", "native_account_links", "planner_notification_preferences", "account_access"]) {
        await pool.query(`DELETE FROM ${table} WHERE owner_clerk_user_id=$1`, [owner]);
      }
      await pool.query("DELETE FROM native_accounts WHERE owner_id=$1", [owner]);
    }
    await pool.query("DELETE FROM native_link_requests WHERE native_issuer=$1 AND native_subject=$2", [f.who.issuer, f.who.subject]);
    await pool.query("DELETE FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2", [f.who.issuer, f.who.subject]);
  }
  await pool.end();
});

async function register(f: ReturnType<typeof fixture>, owner = f.owner) {
  await pool.query(`INSERT INTO native_push_subscriptions(device_id,device_token,environment,owner_clerk_user_id,native_issuer,native_subject)
    VALUES($1,$2,'sandbox',$3,$4,$5)`, [randomUUID(), randomUUID().replaceAll("-", "").repeat(2), owner, f.who.issuer, f.who.subject]);
}

test("review/cancel changes nothing; confirmations cannot target another account or a changed link", async () => {
  const a = fixture(), b = fixture();
  await a.prepare(a.who);
  await b.prepare(b.who);
  const preview = await previewNativeAccountDeletion(a.who);
  assert.equal(preview.scope, "independent");
  assert.equal(preview.status, "not_requested");
  assert.equal(preview.supportReference, null);
  assert.match(preview.explanation, /photos and videos/);
  // Cancel is simply closing the native alert: preview has no write side effects.
  assert.equal((await pool.query("SELECT 1 FROM native_account_deletions WHERE native_subject=$1", [a.who.subject])).rowCount, 0);
  assert.equal((await pool.query("SELECT lifecycle_status FROM account_access WHERE owner_clerk_user_id=$1", [a.owner])).rows[0].lifecycle_status, "active");
  await assert.rejects(requestNativeAccountDeletion(b.who, preview), (e: any) => e.status === 409);
  await assert.rejects(requestNativeAccountDeletion(a.who, { ...preview, scope: "iphone_access" }), (e: any) => e.status === 409);
  await assertNativeNotDeleting(a.who);
  await assertNativeNotDeleting(b.who);
});

test("independent removal is terminal, idempotent, blocks setup/linking and retries provider and media cleanup", async () => {
  const f = fixture(), other = fixture();
  await f.prepare(f.who);
  await other.prepare(other.who);
  await createNativeSupporterProfileService().update(f.who, {
    athleteName: "Deletion Fixture", teamName: "Fixture Team", jerseyNumber: "7", position: "", sport: "soccer", completeSetup: true,
  });
  await register(f);
  await register(other);
  const paths = [`/objects/delete-fixture/${randomUUID()}.webp`, `/objects/delete-fixture/${randomUUID()}.webp`];
  await pool.query("UPDATE athlete_invites SET photo_object_path=$2,cutout_object_path=$3 WHERE owner_clerk_user_id=$1", [f.owner, ...paths]);
  const preview = await previewNativeAccountDeletion(f.who);
  const results = await Promise.all([requestNativeAccountDeletion(f.who, preview), requestNativeAccountDeletion(f.who, preview)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].status, "accepted");
  assert.match(results[0].supportReference, /^[0-9a-f-]{36}$/);
  const stored = (await pool.query("SELECT id FROM native_account_deletions WHERE native_issuer=$1 AND native_subject=$2",
    [f.who.issuer, f.who.subject])).rows[0];
  assert.equal(results[0].supportReference, stored.id);
  assert.equal((await previewNativeAccountDeletion(f.who)).supportReference, stored.id);
  assert.equal((await previewNativeAccountDeletion(other.who)).supportReference, null);
  // Neither another subject nor another issuer gains authority from the UUID.
  for (const who of [other.who, { ...f.who, issuer: "https://other-native.clerk.accounts.dev" }]) {
    await assert.rejects(requestNativeAccountDeletion(who, { scope: preview.scope, target: stored.id }),
      (e: any) => e.status === 409);
    assert.equal((await previewNativeAccountDeletion(who)).supportReference, null);
  }
  assert.equal((await pool.query("SELECT 1 FROM native_account_deletions WHERE native_subject=$1", [f.who.subject])).rowCount, 1);
  assert.equal((await previewNativeAccountDeletion(f.who)).status, "pending");
  assert.equal((await pool.query("SELECT 1 FROM native_push_subscriptions WHERE native_subject=$1", [f.who.subject])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM native_push_subscriptions WHERE native_subject=$1", [other.who.subject])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM native_account_links WHERE native_subject=$1", [f.who.subject])).rowCount, 0);
  await assert.rejects(f.prepare(f.who), (e: any) => e.status === 423);
  await assert.rejects(createNativeAccountLinkService().start(f.who, "x".repeat(43)), (e: any) => e.status === 423);
  await assert.rejects(createNativeAccountLinkService().complete(f.who, randomUUID(), "x".repeat(43)), (e: any) => e.status === 423);
  await cancelAccount(f.owner);
  await reactivateAccount(f.owner);
  await resumeAccount(f.owner);
  assert.equal((await pool.query("SELECT lifecycle_status FROM account_access WHERE owner_clerk_user_id=$1", [f.owner])).rows[0].lifecycle_status, "deletion_pending");

  let failProvider = true, failStorage = true, providerCalls = 0;
  const deleted: string[] = [];
  const deleteIdentity = async (who: typeof f.who) => {
    assert.deepEqual(who, f.who);
    providerCalls++;
    if (failProvider) throw new Error("Fixture provider unavailable");
  };
  const purgeOwner = async (owner: string) => {
    assert.equal(owner, f.owner);
    await runExpiredAccountPurge({ ownerClerkUserId: owner, dependencies: {
      deleteClerkUser: async () => { assert.fail("Must never call the managed PWA provider"); },
      deleteNativeUser: deleteIdentity,
      deleteObject: async (path) => {
        if (failStorage) throw new Error("Fixture storage unavailable");
        deleted.push(path);
      },
    } });
  };
  await runNativeAccountDeletions({ deleteIdentity, purgeOwner }, f.who);
  assert.equal(providerCalls, 1);
  assert.equal((await previewNativeAccountDeletion(f.who)).status, "pending");
  failProvider = false;
  await runNativeAccountDeletions({ deleteIdentity, purgeOwner }, f.who);
  assert.equal((await pool.query("SELECT 1 FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.owner])).rowCount, 1);
  failStorage = false;
  await runNativeAccountDeletions({ deleteIdentity, purgeOwner }, f.who);
  assert.deepEqual(deleted.sort(), paths.sort());
  assert.equal((await previewNativeAccountDeletion(f.who)).status, "completed");
  assert.equal((await previewNativeAccountDeletion(f.who)).supportReference, stored.id);
  assert.deepEqual(await requestNativeAccountDeletion(f.who, preview), results[0]);
  for (const table of ["account_access", "athlete_invites", "native_push_subscriptions"]) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE owner_clerk_user_id=$1`, [f.owner])).rowCount, 0);
  }
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE owner_id=$1", [f.owner])).rowCount, 0);
  await assert.rejects(f.prepare(f.who), (e: any) => e.status === 423);
  const callsBefore = providerCalls;
  await runNativeAccountDeletions({ deleteIdentity, purgeOwner }, f.who);
  assert.equal(providerCalls, callsBefore);
  assert.equal((await pool.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [other.owner])).rowCount, 1);
});

test("legacy-linked removal preserves the PWA identity, lifecycle, profile, media and preferences", async () => {
  const f = fixture();
  const owner = `legacy-${f.owner}`;
  await pool.query("INSERT INTO account_access(owner_clerk_user_id,role,access_mode) VALUES($1,'fan','free')", [owner]);
  await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES($1,$2,$3,'Legacy fixture')`, [f.who.issuer, f.who.subject, owner]);
  await pool.query(`INSERT INTO planner_notification_preferences(owner_clerk_user_id,one_hour_before,day_of)
    VALUES($1,true,true)`, [owner]);
  await pool.query(`INSERT INTO athlete_invites(owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,photo_object_path)
    VALUES($1,$2,'Legacy athlete','Legacy team','Season',NOW()+INTERVAL '1 year','soccer','/objects/legacy-preserved.webp')`, [owner, randomUUID()]);
  await register(f, owner);
  const before = (await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [owner])).rows;
  const preview = await previewNativeAccountDeletion(f.who);
  assert.equal(preview.scope, "iphone_access");
  assert.match(preview.explanation, /will NOT be deleted/);
  await requestNativeAccountDeletion(f.who, preview);
  const identities: typeof f.who[] = [];
  await runNativeAccountDeletions({
    deleteIdentity: async (who) => { identities.push(who); },
    purgeOwner: async () => { assert.fail("Cannot purge a linked PWA owner"); },
  }, f.who);
  assert.deepEqual(identities, [f.who]);
  assert.deepEqual((await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [owner])).rows, before);
  assert.equal((await pool.query("SELECT lifecycle_status FROM account_access WHERE owner_clerk_user_id=$1", [owner])).rows[0].lifecycle_status, "active");
  assert.equal((await pool.query("SELECT one_hour_before FROM planner_notification_preferences WHERE owner_clerk_user_id=$1", [owner])).rows[0].one_hour_before, true);
  assert.equal((await previewNativeAccountDeletion(f.who)).status, "completed");
  await assert.rejects(f.prepare(f.who), (e: any) => e.status === 423);
});

test("native provider deletion proves issuer/key connection before deleting the exact subject; 404 retries succeed", async () => {
  const old = process.env.NATIVE_IOS_CLERK_ISSUER;
  const f = fixture();
  process.env.NATIVE_IOS_CLERK_ISSUER = f.who.issuer;
  const keys = { keys: [{ kid: "native", kty: "RSA", n: "native-modulus", e: "AQAB" }] };
  let mismatch = true, status = 200;
  const deleted: string[] = [];
  const remove = createNativeProviderDeletion({
    read: async () => Response.json(mismatch ? { keys: [{ ...keys.keys[0], n: "web-modulus" }] } : keys),
    issuerKeys: async (issuer) => { assert.equal(issuer, f.who.issuer); return Response.json(keys); },
    remove: async (subject) => { deleted.push(subject); return Response.json({}, { status }); },
  });
  try {
    await assert.rejects(remove(f.who), (e: any) => e.status === 503);
    assert.deepEqual(deleted, []);
    mismatch = false;
    await assert.rejects(remove({ ...f.who, issuer: "https://web-fixture.clerk.accounts.dev" }), (e: any) => e.status === 401);
    assert.deepEqual(deleted, []);
    await remove(f.who);
    status = 404;
    await remove(f.who);
    status = 503;
    await assert.rejects(remove(f.who), (e: any) => e.status === 503);
    assert.deepEqual(deleted, [f.who.subject, f.who.subject, f.who.subject]);
  } finally {
    if (old === undefined) delete process.env.NATIVE_IOS_CLERK_ISSUER;
    else process.env.NATIVE_IOS_CLERK_ISSUER = old;
  }
});

test("scheduled retries reach newer requests despite more than a full batch of older provider failures", async () => {
  const older = Array.from({ length: 27 }, () => fixture());
  const newer = fixture();
  for (const f of [...older, newer]) {
    await pool.query(`INSERT INTO native_account_deletions(native_issuer,native_subject,scope,target,requested_at)
      VALUES($1,$2,'iphone_access','unlinked',$3)`,
    [f.who.issuer, f.who.subject, new Date(Date.now() - (f === newer ? 0 : 60_000))]);
  }
  const attempted: string[] = [];
  const deps = {
    deleteIdentity: async (who: typeof newer.who) => {
      attempted.push(who.subject);
      if (who.subject !== newer.who.subject) throw new Error("Old fixture provider failure");
    },
    purgeOwner: async () => { assert.fail("Access-only requests never purge a PWA owner"); },
  };
  await runNativeAccountDeletions(deps, { issuer: newer.who.issuer });
  assert.equal(attempted.length, 25);
  assert.equal(attempted.includes(newer.who.subject), false);
  await runNativeAccountDeletions(deps, { issuer: newer.who.issuer });
  assert.equal(attempted.includes(newer.who.subject), true);
  assert.equal((await previewNativeAccountDeletion(newer.who)).status, "completed");
  for (const f of older) {
    assert.equal((await previewNativeAccountDeletion(f.who)).status, "pending");
  }
});

test("a locked old deletion batch does not exclude the next request from future retries", async () => {
  const locked = Array.from({ length: 25 }, () => fixture());
  const next = fixture();
  const ids: string[] = [];
  for (const f of [...locked, next]) {
    const result = await pool.query(`INSERT INTO native_account_deletions(native_issuer,native_subject,scope,target,requested_at)
      VALUES($1,$2,'iphone_access','unlinked',$3) RETURNING id`,
    [f.who.issuer, f.who.subject, new Date(Date.now() - (f === next ? 0 : 60_000))]);
    if (f !== next) ids.push(result.rows[0].id);
  }
  const lockHolder = await pool.connect();
  const attempted: string[] = [];
  try {
    for (const id of ids) {
      await lockHolder.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`native-delete:${id}`]);
    }
    const deps = {
      deleteIdentity: async (who: typeof next.who) => {
        attempted.push(who.subject);
        if (who.subject !== next.who.subject) throw new Error("Other pending fixture");
      },
      purgeOwner: async () => { assert.fail("Access-only deletion"); },
    };
    // Earlier failed fixtures may still be pending; rotation must make progress
    // across them and the locked batch instead of repeatedly selecting either.
    for (let run = 0; run < 4 && !attempted.includes(next.who.subject); run++) {
      await runNativeAccountDeletions(deps, { issuer: next.who.issuer });
    }
    assert.equal(attempted.includes(next.who.subject), true);
    assert.equal((await previewNativeAccountDeletion(next.who)).status, "completed");
    assert.equal(locked.some(f => attempted.includes(f.who.subject)), false);
  } finally {
    for (const id of ids) {
      await lockHolder.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`native-delete:${id}`]);
    }
    lockHolder.release();
  }
});
