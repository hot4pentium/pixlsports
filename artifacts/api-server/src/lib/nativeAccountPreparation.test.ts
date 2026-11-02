import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { createNativeAccountPreparation, nativeSignupExternalId } from "./nativeAccountPreparation";
import { createNativeSupporterProfileService } from "./nativeSupporterProfile";
import { loadNativeSupporterHypeCard } from "./nativeSupporterHypeCard";
import { createNativeAthletePhotoService } from "./nativeAthletePhoto";
import { readNativeOwnerMetadata } from "./nativeOwnerMetadata";

const ownerIds: string[] = [];
const subjects: string[] = [];
after(async () => {
  for (const owner of ownerIds) {
    await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=$1", [owner]);
    await pool.query("DELETE FROM native_account_links WHERE owner_clerk_user_id=$1", [owner]);
    await pool.query("DELETE FROM admin_identity_blocks WHERE clerk_user_id=$1", [owner]);
    await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=$1", [owner]);
    await pool.query("DELETE FROM native_accounts WHERE owner_id=$1", [owner]);
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
  const nativeOwner = nativeSignupExternalId(who);
  ownerIds.push(nativeOwner);
  const native = { createdAt: Date.now(), verifiedEmails: [`${randomUUID()}@example.com`] };
  let owners: typeof owner[] = [];
  let reads = 0;
  let originReads = 0;
  const prepare = createNativeAccountPreparation({
    async loadIdentity() { reads++; return native; },
    async findOwners(origin) { originReads++; assert.equal(origin, nativeOwner); return owners; },
  });
  return { who, owner, nativeOwner, native, prepare, setOwners: (value: typeof owner[]) => { owners = value; },
    reads: () => reads, originReads: () => originReads };
}
async function existingAccess(owner: string, status = "active") {
  await pool.query(`INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free',$2)`, [owner, status]);
}

test("new iPhone signup reaches athlete setup and creates only a private starter card", async () => {
  const f = fixture();
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  const access = await pool.query("SELECT role,access_mode FROM account_access WHERE owner_clerk_user_id=$1", [f.nativeOwner]);
  assert.deepEqual(access.rows[0], { role: "fan", access_mode: "free" });
  const profile = createNativeSupporterProfileService();
  assert.equal((await profile.load(f.who)).athleteName, "");
  const saved = await profile.update(f.who, {
    athleteName: "Native Star", teamName: "", jerseyNumber: "", position: "",
    sport: "softball", completeSetup: true,
  });
  assert.equal(saved.athleteName, "Native Star");
  const cards = await pool.query(`SELECT sport,paused,show_hype_card,show_stats,show_schedule,show_events
    FROM athlete_invites WHERE owner_clerk_user_id=$1`, [f.nativeOwner]);
  assert.equal(cards.rowCount, 1);
  assert.deepEqual(cards.rows[0], {
    sport: "softball", paused: true, show_hype_card: false, show_stats: false,
    show_schedule: false, show_events: false,
  });
  assert.equal((await createNativeSupporterProfileService().load(f.who)).athleteName, "Native Star");
  const preview = await loadNativeSupporterHypeCard(f.who);
  assert.equal(preview.status, "hidden");
  assert.equal(preview.privatePreview?.athleteName, "Native Star");
  const photo = await createNativeAthletePhotoService().state(f.who);
  assert.equal(photo.athleteName, "Native Star");
  assert.equal(photo.hasPhoto, false);
});

test("legacy linked iPhone relaunch after a lost Clerk response resumes setup without duplicating the account or card", async () => {
  const f = fixture();
  // New native profiles now save atomically in PostgreSQL. Preserve coverage
  // of partial remote success for existing managed-Clerk-backed iPhone owners.
  await existingAccess(f.owner.id);
  await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES($1,$2,$3,'Legacy iPhone')`, [f.who.issuer, f.who.subject, f.owner.id]);
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  const input = {
    athleteName: "Relaunch Star", teamName: "Falcons", jerseyNumber: "12", position: "Pitcher",
    sport: "softball", completeSetup: true,
  };
  const interrupted = createNativeSupporterProfileService({
    async getUser() { return { unsafeMetadata: f.owner.unsafeMetadata }; },
    async updateUser(_owner, metadata) {
      // Remote success is durable even though the caller sees a failed request.
      f.owner.unsafeMetadata = structuredClone(metadata);
      throw new Error("Managed Clerk response lost after commit");
    },
  });
  await assert.rejects(interrupted.update(f.who, input), (error: any) => error.status === 503);
  assert.equal(f.owner.unsafeMetadata.athleteName, input.athleteName);
  assert.equal((await pool.query("SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.owner.id])).rowCount, 0);

  // Cold launch: no previous service/UI state survives, just the verified link,
  // persisted Clerk metadata and database rows.
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  assert.equal(f.reads(), 0);
  assert.equal(f.originReads(), 0);
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE owner_id=$1", [f.nativeOwner])).rowCount, 0);
  const relaunched = createNativeSupporterProfileService({
    async getUser() { return { unsafeMetadata: f.owner.unsafeMetadata }; },
    async updateUser(_owner, metadata) { f.owner.unsafeMetadata = structuredClone(metadata); },
  });
  const loaded = await relaunched.load(f.who);
  assert.deepEqual(loaded, {
    athleteName: input.athleteName, teamName: input.teamName, jerseyNumber: input.jerseyNumber,
    position: input.position, sport: input.sport, requiresSetup: true,
  });
  // Repeated startup reads must not silently create or publish a card.
  assert.equal((await relaunched.load(f.who)).requiresSetup, true);
  assert.equal((await pool.query("SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.owner.id])).rowCount, 0);
  await relaunched.update(f.who, { ...loaded, completeSetup: true });
  const firstCard = (await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.owner.id])).rows;
  assert.equal(firstCard.length, 1);
  assert.deepEqual(
    [firstCard[0].paused, firstCard[0].show_hype_card, firstCard[0].show_stats, firstCard[0].show_schedule, firstCard[0].show_events],
    [true, false, false, false, false],
  );
  assert.equal(firstCard[0].sport, "softball");
  assert.equal(firstCard[0].photo_object_path, null);
  assert.equal(firstCard[0].live_tracker_share_token, null);
  assert.equal((await relaunched.load(f.who)).requiresSetup, false);
  // Continue retry and another launch keep the exact same private card.
  await relaunched.update(f.who, { ...loaded, completeSetup: true });
  assert.deepEqual((await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.owner.id])).rows, firstCard);
  assert.equal((await relaunched.load(f.who)).requiresSetup, false);
});

test("simultaneous startup calls create one account and returning startup makes no provider lookup", async () => {
  const f = fixture();
  const result = await Promise.all([f.prepare(f.who), f.prepare(f.who)]);
  assert.deepEqual(result, [{ status: "ready" }, { status: "ready" }]);
  assert.equal(f.reads(), 1);
  assert.equal(f.originReads(), 1);
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE owner_id=$1", [f.nativeOwner])).rowCount, 1);
});

test("a matching PWA email gets a separate empty iOS profile without changing the PWA owner", async () => {
  const f = fixture();
  f.owner.externalId = "an-existing-web-identity";
  f.setOwners([f.owner]);
  await existingAccess(f.owner.id);
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  const profile = createNativeSupporterProfileService();
  assert.equal((await profile.load(f.who)).athleteName, "");
  await profile.update(f.who, { athleteName: "iPhone Only", teamName: "", jerseyNumber: "", position: "", sport: "soccer" });
  assert.deepEqual(f.owner.unsafeMetadata, {});
  const links = await pool.query("SELECT owner_clerk_user_id FROM native_account_links WHERE native_subject=$1", [f.who.subject]);
  assert.equal(links.rows[0].owner_clerk_user_id, f.nativeOwner);
  assert.notEqual(f.nativeOwner, f.owner.id);
  assert.equal((await pool.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [f.owner.id])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.owner.id])).rowCount, 0);
});

test("unverified native emails cannot create an owner", async () => {
  const f = fixture();
  f.native.verifiedEmails = [];
  await assert.rejects(f.prepare(f.who), /Verify your email/);
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE owner_id=$1", [f.nativeOwner])).rowCount, 0);
});

test("an interrupted former provider creation can finish with independent native storage", async () => {
  const f = fixture();
  f.setOwners([f.owner]);
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  assert.equal((await pool.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [f.owner.id])).rowCount, 0);
  assert.equal((await readNativeOwnerMetadata(f.nativeOwner)).unsafeMetadata.athleteName, undefined);
});

test("a deliberately disconnected legacy signup is not silently replaced", async () => {
  const f = fixture();
  f.setOwners([f.owner]);
  await existingAccess(f.owner.id);
  assert.deepEqual(await f.prepare(f.who), { status: "link_required" });
  assert.equal((await pool.query("SELECT 1 FROM native_account_links WHERE native_subject=$1", [f.who.subject])).rowCount, 0);
});

test("a blocked native identity cannot get new access or a native link", async () => {
  const f = fixture();
  await pool.query("INSERT INTO admin_identity_blocks(clerk_user_id,blocked_by_clerk_user_id,reason) VALUES($1,'test-admin','Signup fixture')", [f.nativeOwner]);
  await assert.rejects(f.prepare(f.who), /cannot create an iPhone profile/);
  assert.equal((await pool.query("SELECT 1 FROM account_access WHERE owner_clerk_user_id=$1", [f.nativeOwner])).rowCount, 0);
});

test("linked but cancelled accounts stay cancelled rather than becoming new accounts", async () => {
  const f = fixture();
  await existingAccess(f.owner.id, "cancelled");
  await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES($1,$2,$3,'Test')`, [f.who.issuer, f.who.subject, f.owner.id]);
  await assert.rejects(f.prepare(f.who), /not eligible/);
  assert.equal(f.reads(), 0);
});

test("an existing linked iOS profile keeps its original owner and makes no provider calls", async () => {
  const f = fixture();
  await existingAccess(f.owner.id);
  await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES($1,$2,$3,'Existing')`, [f.who.issuer, f.who.subject, f.owner.id]);
  assert.deepEqual(await f.prepare(f.who), { status: "ready" });
  assert.equal(f.reads(), 0);
  assert.equal(f.originReads(), 0);
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE owner_id=$1", [f.nativeOwner])).rowCount, 0);
});

test("an established native profile is never replaced after its mapping is revoked", async () => {
  const f = fixture();
  await f.prepare(f.who);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=$1", [f.who.subject]);
  await assert.rejects(f.prepare(f.who), /access needs recovery/);
  assert.equal(f.reads(), 1);
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE owner_id=$1", [f.nativeOwner])).rowCount, 1);
});

test("a cancelled standalone iOS profile cannot restart onboarding or edit its athlete", async () => {
  const f = fixture();
  await f.prepare(f.who);
  await pool.query("UPDATE account_access SET lifecycle_status='cancelled' WHERE owner_clerk_user_id=$1", [f.nativeOwner]);
  await assert.rejects(f.prepare(f.who), /not eligible/);
  await assert.rejects(createNativeSupporterProfileService().load(f.who), /can’t edit athlete/);
  assert.equal(f.reads(), 1);
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE owner_id=$1", [f.nativeOwner])).rowCount, 1);
});

test("accounts in different native issuers never share an owner even for the same subject and email", async () => {
  const f = fixture();
  await f.prepare(f.who);
  const other = { ...f.who, issuer: `${f.who.issuer}/other-instance` };
  const owner = nativeSignupExternalId(other);
  ownerIds.push(owner);
  const prepare = createNativeAccountPreparation({
    async loadIdentity() { return f.native; },
    async findOwners() { return []; },
  });
  await prepare(other);
  assert.notEqual(owner, f.nativeOwner);
  assert.equal((await pool.query("SELECT 1 FROM native_accounts WHERE native_subject=$1", [f.who.subject])).rowCount, 2);
});

test("native profile and starter creation roll back together after a write failure", async () => {
  const f = fixture();
  await f.prepare(f.who);
  const profile = createNativeSupporterProfileService({
    getUser: readNativeOwnerMetadata,
    async updateUser(_owner, _metadata, tx) {
      await tx!.query("UPDATE native_accounts SET profile_metadata=$2::jsonb WHERE owner_id=$1",
        [f.nativeOwner, JSON.stringify({ athleteName: "Must Roll Back" })]);
      throw new Error("simulated failure after metadata write");
    },
  });
  await assert.rejects(profile.update(f.who, {
    athleteName: "Must Roll Back", teamName: "", jerseyNumber: "", position: "", sport: "soccer", completeSetup: true,
  }), /could not be saved/);
  const relaunched = createNativeSupporterProfileService();
  const incomplete = await relaunched.load(f.who);
  assert.equal(incomplete.athleteName, "");
  assert.equal(incomplete.requiresSetup, true);
  assert.equal((await pool.query("SELECT 1 FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.nativeOwner])).rowCount, 0);
  const recoveredInput = {
    athleteName: "Recovered", teamName: "", jerseyNumber: "", position: "", sport: "soccer", completeSetup: true,
  };
  await relaunched.update(f.who, recoveredInput);
  const completed = await createNativeSupporterProfileService().load(f.who);
  assert.equal(completed.athleteName, "Recovered");
  assert.equal(completed.requiresSetup, false);
  const cards = (await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.nativeOwner])).rows;
  assert.equal(cards.length, 1);
  assert.deepEqual(
    [cards[0].paused, cards[0].show_hype_card, cards[0].show_stats, cards[0].show_schedule, cards[0].show_events],
    [true, false, false, false, false],
  );
  await relaunched.update(f.who, recoveredInput);
  assert.deepEqual((await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [f.nativeOwner])).rows, cards);
});
