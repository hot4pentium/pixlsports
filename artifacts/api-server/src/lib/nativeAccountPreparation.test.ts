import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { createNativeAccountPreparation, nativeSignupExternalId } from "./nativeAccountPreparation";
import { createNativeSupporterProfileService } from "./nativeSupporterProfile";

const ownerIds: string[] = [];
const subjects: string[] = [];
after(async () => {
  for (const owner of ownerIds) {
    await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=$1", [owner]);
    await pool.query("DELETE FROM native_account_links WHERE owner_clerk_user_id=$1", [owner]);
    await pool.query("DELETE FROM admin_identity_blocks WHERE clerk_user_id=$1", [owner]);
    await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=$1", [owner]);
  }
  for (const subject of subjects) await pool.query("DELETE FROM native_account_links WHERE native_subject=$1", [subject]);
  await pool.end();
});

function fixture() {
  const who = {
    issuer: "https://native-signup-fixture.clerk.accounts.dev",
    subject: `user_nativeSignup${randomUUID().replaceAll("-", "")}`,
  };
  subjects.push(who.subject);
  const owner = {
    id: `user_signupOwner${randomUUID().replaceAll("-", "")}`,
    externalId: nativeSignupExternalId(who),
    createdAt: Date.now(),
    publicMetadata: { pixlNativeSignup: true } as Record<string, unknown>,
    unsafeMetadata: {} as Record<string, unknown>,
  };
  ownerIds.push(owner.id);
  const native = { createdAt: Date.now(), verifiedEmails: [`${randomUUID()}@example.com`] };
  let owners: typeof owner[] = [];
  let created = 0;
  let reads = 0;
  const prepare = createNativeAccountPreparation({
    async loadIdentity() { reads++; return native; },
    async findOwners() { return owners; },
    async createOwner() { created++; owners = [owner]; return owner; },
    async markProvisioned() { owner.publicMetadata.pixlSportsAccountProvisioned = true; },
  });
  return { who, owner, native, prepare, setOwners: (value: typeof owner[]) => { owners = value; },
    created: () => created, reads: () => reads };
}
async function existingAccess(owner: string, status = "active") {
  await pool.query(`INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free',$2)`, [owner, status]);
}

test("new iPhone signup reaches athlete setup and creates only a private starter card", async () => {
  const f = fixture();
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  const access = await pool.query("SELECT role,access_mode FROM account_access WHERE owner_clerk_user_id=$1", [f.owner.id]);
  assert.deepEqual(access.rows[0], { role: "fan", access_mode: "free" });
  const profile = createNativeSupporterProfileService({
    async getUser() { return { unsafeMetadata: f.owner.unsafeMetadata }; },
    async updateUser(_owner, metadata) { f.owner.unsafeMetadata = metadata; },
  });
  assert.equal((await profile.load(f.who)).athleteName, "");
  const saved = await profile.update(f.who, {
    athleteName: "Native Star", teamName: "", jerseyNumber: "", position: "",
    sport: "softball", completeSetup: true,
  });
  assert.equal(saved.athleteName, "Native Star");
  const cards = await pool.query(`SELECT sport,paused,show_hype_card,show_stats,show_schedule,show_events
    FROM athlete_invites WHERE owner_clerk_user_id=$1`, [f.owner.id]);
  assert.equal(cards.rowCount, 1);
  assert.deepEqual(cards.rows[0], {
    sport: "softball", paused: true, show_hype_card: false, show_stats: false,
    show_schedule: false, show_events: false,
  });
});

test("simultaneous startup calls create one account and returning startup makes no provider lookup", async () => {
  const f = fixture();
  const result = await Promise.all([f.prepare(f.who), f.prepare(f.who)]);
  assert.deepEqual(result, [{ status: "ready" }, { status: "ready" }]);
  assert.equal(f.created(), 1);
  assert.equal(f.reads(), 1);
});

test("matching an existing web email never auto-links, changes, or duplicates the account", async () => {
  const f = fixture();
  f.owner.externalId = "an-existing-web-identity";
  f.setOwners([f.owner]);
  await existingAccess(f.owner.id);
  assert.deepEqual(await f.prepare(f.who), { status: "link_required" });
  assert.equal(f.created(), 0);
  assert.equal((await pool.query("SELECT 1 FROM native_account_links WHERE native_subject=$1", [f.who.subject])).rowCount, 0);
});

test("unverified native emails cannot create an owner", async () => {
  const f = fixture();
  f.native.verifiedEmails = [];
  await assert.rejects(f.prepare(f.who), /Verify your email/);
  assert.equal(f.created(), 0);
});

test("an interrupted provider creation resumes the same unused canonical owner", async () => {
  const f = fixture();
  f.setOwners([f.owner]);
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  assert.equal(f.created(), 0);
});

test("a deliberately disconnected account is not silently relinked", async () => {
  const f = fixture();
  f.setOwners([f.owner]);
  await existingAccess(f.owner.id);
  assert.deepEqual(await f.prepare(f.who), { status: "link_required" });
  assert.equal((await pool.query("SELECT 1 FROM native_account_links WHERE native_subject=$1", [f.who.subject])).rowCount, 0);
});

test("a blocked identity cannot get new access or a native link", async () => {
  const f = fixture();
  f.setOwners([f.owner]);
  await pool.query("INSERT INTO admin_identity_blocks(clerk_user_id,blocked_by_clerk_user_id,reason) VALUES($1,'test-admin','Signup fixture')", [f.owner.id]);
  await assert.rejects(f.prepare(f.who), /cannot create a new PIXL account/);
  assert.equal((await pool.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [f.owner.id])).rowCount, 0);
});

test("linked but cancelled accounts stay cancelled rather than becoming new accounts", async () => {
  const f = fixture();
  await existingAccess(f.owner.id, "cancelled");
  await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES($1,$2,$3,'Test')`, [f.who.issuer, f.who.subject, f.owner.id]);
  await assert.rejects(f.prepare(f.who), /not eligible/);
  assert.equal(f.created(), 0);
  assert.equal(f.reads(), 0);
});

test("a provisioning-marker outage does not lose the committed account or duplicate it on retry", async () => {
  const f = fixture();
  const prepare = createNativeAccountPreparation({
    async loadIdentity() { return f.native; },
    async findOwners() { return []; },
    async createOwner() { return f.owner; },
    async markProvisioned() { throw new Error("simulated outage"); },
  });
  assert.deepEqual(await prepare(f.who), { status: "ready" });
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  assert.equal(f.created(), 0);
});
