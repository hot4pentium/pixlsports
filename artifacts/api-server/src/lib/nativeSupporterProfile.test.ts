import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  createNativeSupporterProfileService,
  type NativeSupporterProfile,
} from "./nativeSupporterProfile";
import type { NativeIdentity } from "./nativeIdentity";
import { createNativeAthletePhotoService } from "./nativeAthletePhoto";

const owners: string[] = [];
const nativeSubjects: string[] = [];

function identity(): NativeIdentity {
  const subject = `user_nativeProfile${randomUUID().replaceAll("-", "")}`;
  nativeSubjects.push(subject);
  return { issuer: "https://native-profile-fixture.clerk.accounts.dev", subject };
}

async function owner() {
  const id = `user_webProfile${randomUUID().replaceAll("-", "")}`;
  owners.push(id);
  await pool.query(
    `INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
     VALUES ($1,'fan','free','active')`,
    [id],
  );
  return id;
}

async function link(who: NativeIdentity, ownerId: string) {
  await pool.query(
    `INSERT INTO native_account_links
      (native_issuer,native_subject,owner_clerk_user_id,account_label)
     VALUES ($1,$2,$3,'Athlete profile test')`,
    [who.issuer, who.subject, ownerId],
  );
}

async function invite(ownerId: string, athlete: string, team: string) {
  const token = randomBytes(18).toString("base64url");
  await pool.query(
    `INSERT INTO athlete_invites
      (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
     VALUES ($1,$2,$3,$4,'Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York')`,
    [ownerId, token, athlete, team],
  );
  return token;
}

function createService(metadataByOwner: Map<string, Record<string, unknown>>) {
  const writes: Array<{ owner: string; metadata: Record<string, unknown> }> = [];
  const service = createNativeSupporterProfileService({
    getUser: async (ownerId) => ({ unsafeMetadata: metadataByOwner.get(ownerId) ?? {} }),
    updateUser: async (ownerId, metadata) => {
      writes.push({ owner: ownerId, metadata });
      metadataByOwner.set(ownerId, structuredClone(metadata));
    },
  });
  return { service, writes };
}

after(async () => {
  await pool.query("DELETE FROM athlete_editor_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [nativeSubjects]);
  await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

test("linked owner can load and update athlete profile without publishing a private HYPE Card", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await invite(linkedOwner, "Tim", "Tigers");
  await pool.query(
    `UPDATE athlete_invites
     SET show_hype_card=false, show_stats=false, show_events=false, paused=true
     WHERE owner_clerk_user_id=$1`,
    [linkedOwner],
  );

  const metadata = new Map<string, Record<string, unknown>>([
    [linkedOwner, {
      athleteName: " Tim ",
      teamName: " Tigers ",
      seasonName: "26",
      displayName: "Family",
      unrelatedFlag: true,
    }],
  ]);
  const { service, writes } = createService(metadata);

  assert.deepEqual(await service.load(who), {
    athleteName: "Tim",
    teamName: "Tigers",
    jerseyNumber: "",
    position: "",
    requiresSetup: false,
  });

  const profile: NativeSupporterProfile = {
    athleteName: "Timothy",
    teamName: "Tigers 26",
    jerseyNumber: "#7",
    position: "Forward",
  };
  assert.deepEqual(await service.update(who, profile), {
    athleteName: "Timothy",
    teamName: "Tigers 26",
    jerseyNumber: "7",
    position: "Forward",
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(metadata.get(linkedOwner), {
    athleteName: "Timothy",
    teamName: "Tigers 26",
    jerseyNumber: "7",
    position: "Forward",
    seasonName: "26",
    displayName: "Family",
    unrelatedFlag: true,
  });

  const saved = await pool.query<{
    athlete_name: string;
    team_name: string;
    show_hype_card: boolean;
    show_stats: boolean;
    show_events: boolean;
    paused: boolean;
  }>(
    `SELECT athlete_name, team_name, show_hype_card, show_stats, show_events, paused
     FROM athlete_invites WHERE owner_clerk_user_id=$1`,
    [linkedOwner],
  );
  assert.deepEqual(saved.rows[0], {
    athlete_name: "Timothy",
    team_name: "Tigers 26",
    show_hype_card: false,
    show_stats: false,
    show_events: false,
    paused: true,
  });
});

test("optional fields may be blank and do not erase a saved HYPE Card team", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await invite(linkedOwner, "Tim", "Tigers");
  const metadata = new Map<string, Record<string, unknown>>([
    [linkedOwner, { athleteName: "Tim", teamName: "Tigers" }],
  ]);
  const { service } = createService(metadata);

  await assert.rejects(
    service.update(who, {
      athleteName: "   ",
      teamName: "",
      jerseyNumber: "",
      position: "",
    }),
    (error: any) => error.status === 400,
  );

  const updated = await service.update(who, {
    athleteName: "Tim",
    teamName: "",
    jerseyNumber: "",
    position: "",
  });
  assert.deepEqual(updated, {
    athleteName: "Tim",
    teamName: "",
    jerseyNumber: "",
    position: "",
  });
  const saved = await pool.query<{ team_name: string }>(
    "SELECT team_name FROM athlete_invites WHERE owner_clerk_user_id=$1",
    [linkedOwner],
  );
  assert.equal(saved.rows[0]?.team_name, "Tigers");
});

test("profile updates do not silently replace an already mismatched HYPE Card identity", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await invite(linkedOwner, "Another athlete", "Wolves");
  const metadata = new Map<string, Record<string, unknown>>([
    [linkedOwner, { athleteName: "Jordan", teamName: "Tigers" }],
  ]);
  const { service } = createService(metadata);

  await service.update(who, {
    athleteName: "Jordan",
    teamName: "Tigers 26",
    jerseyNumber: "",
    position: "",
  });

  const saved = await pool.query<{ athlete_name: string; team_name: string }>(
    "SELECT athlete_name, team_name FROM athlete_invites WHERE owner_clerk_user_id=$1",
    [linkedOwner],
  );
  assert.deepEqual(saved.rows[0], {
    athlete_name: "Another athlete",
    team_name: "Wolves",
  });
});

test("unlinked or ineligible identities cannot read or update a web profile", async () => {
  const who = identity();
  const unlinkedStore = new Map<string, Record<string, unknown>>();
  const unlinked = createService(unlinkedStore);
  await assert.rejects(
    unlinked.service.load(who),
    (error: any) => error.status === 409,
  );
  await assert.rejects(
    unlinked.service.update(who, {
      athleteName: "Tim",
      teamName: "",
      jerseyNumber: "",
      position: "",
    }),
    (error: any) => error.status === 409,
  );
  assert.equal(unlinked.writes.length, 0);

  const blockedIdentity = identity();
  const blockedOwner = await owner();
  await link(blockedIdentity, blockedOwner);
  await pool.query(
    "UPDATE account_access SET admin_suspended_at=NOW() WHERE owner_clerk_user_id=$1",
    [blockedOwner],
  );
  const blocked = createService(new Map([[blockedOwner, { athleteName: "Tim" }]]));
  await assert.rejects(
    blocked.service.update(blockedIdentity, {
      athleteName: "Other",
      teamName: "",
      jerseyNumber: "",
      position: "",
    }),
    (error: any) => error.status === 423,
  );
  assert.equal(blocked.writes.length, 0);
});

test("first native setup assigns one private softball card using saved season and optional details", async () => {
  const who = identity();
  const id = await owner();
  await link(who, id);
  const metadata = new Map<string, Record<string, unknown>>([
    [id, { sport: "softball", seasonName: "Family season", timezone: "America/New_York", unrelatedFlag: true }],
  ]);
  const { service } = createService(metadata);
  const saved = await service.update(who, {
    athleteName: " Jordan ", teamName: "", jerseyNumber: "#12", position: "Pitcher", completeSetup: true,
  });
  assert.deepEqual(saved, {
    athleteName: "Jordan", teamName: "", jerseyNumber: "12", position: "Pitcher", sport: "softball",
  });
  const { rows } = await pool.query(`SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1`, [id]);
  assert.equal(rows.length, 1);
  const card = rows[0];
  assert.equal(card.athlete_name, "Jordan");
  assert.equal(card.team_name, "");
  assert.equal(card.sport, "softball");
  assert.equal(card.season_name, "Family season");
  assert.equal(card.timezone, "America/New_York");
  assert.ok(new Date(card.season_ends_at).getTime() > Date.now());
  assert.deepEqual(
    [card.show_hype_card, card.show_stats, card.show_schedule, card.show_events, card.paused],
    [false, false, false, false, true],
  );
  assert.equal(card.photo_object_path, null);
  assert.equal(card.live_tracker_share_token, null);
  assert.equal(metadata.get(id)?.unrelatedFlag, true);
  const photos = createNativeAthletePhotoService({
    loadProfile: async () => ({ athleteName: saved.athleteName, teamName: saved.teamName }),
  });
  const photoState = await photos.state(who);
  assert.equal(photoState.cardId, card.id);
  assert.equal(photoState.hasPhoto, false);
});

test("setup retries reuse an authored public card without rewriting its identity, media, or settings", async () => {
  const who = identity();
  const id = await owner();
  await link(who, id);
  await invite(id, "Original athlete", "Original team");
  await pool.query(`UPDATE athlete_invites SET photo_object_path='/objects/original',
    cutout_object_path='/objects/legacy-cutout', card_appearance='{"name":"authored"}',
    favorite_moment='Keep this', show_hype_card=true, paused=false WHERE owner_clerk_user_id=$1`, [id]);
  const before = (await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rows;
  const metadata = new Map<string, Record<string, unknown>>([
    [id, { athleteName: "Original athlete", teamName: "Original team", jerseyNumber: "9", position: "Forward" }],
  ]);
  const { service } = createService(metadata);
  const saved = await service.update(who, {
    athleteName: "Different athlete", teamName: "Different team", jerseyNumber: "", position: "",
    sport: "softball", completeSetup: true,
  });
  assert.deepEqual(saved, {
    athleteName: "Original athlete", teamName: "Original team", jerseyNumber: "9", position: "Forward", sport: "soccer",
  });
  const afterRows = (await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rows;
  assert.deepEqual(afterRows, before);
  assert.equal(metadata.get(id)?.seasonName, "Spring 2099");
});

test("concurrent iPhone setup requests assign only one card", async () => {
  const first = identity();
  const id = await owner();
  await link(first, id);
  const metadata = new Map<string, Record<string, unknown>>();
  const { service } = createService(metadata);
  const results = await Promise.all([
    service.update(first, {
      athleteName: "First athlete", teamName: "Tigers", jerseyNumber: "7", position: "",
      sport: "soccer", completeSetup: true,
    }),
    service.update(first, {
      athleteName: "Other athlete", teamName: "Wolves", jerseyNumber: "8", position: "",
      sport: "softball", completeSetup: true,
    }),
  ]);
  const { rows } = await pool.query("SELECT athlete_name,team_name,sport FROM athlete_invites WHERE owner_clerk_user_id=$1", [id]);
  assert.equal(rows.length, 1);
  for (const result of results) {
    assert.equal(result.athleteName, rows[0].athlete_name);
    assert.equal(result.teamName, rows[0].team_name);
    assert.equal(result.sport, rows[0].sport);
  }
  assert.equal(metadata.get(id)?.athleteName, rows[0].athlete_name);
});

test("a failed profile save rolls back starter creation and can be retried safely", async () => {
  const who = identity();
  const id = await owner();
  await link(who, id);
  let fail = true;
  let metadata: Record<string, unknown> = {};
  const service = createNativeSupporterProfileService({
    getUser: async () => ({ unsafeMetadata: metadata }),
    updateUser: async (_owner, value) => {
      if (fail) throw new Error("Temporary Clerk failure");
      metadata = value;
    },
  });
  const input = { athleteName: "Jordan", teamName: "", jerseyNumber: "", position: "", sport: "volleyball", completeSetup: true };
  await assert.rejects(service.update(who, input), (error: any) => error.status === 503);
  assert.equal((await pool.query("SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rowCount, 0);
  fail = false;
  await service.update(who, input);
  await service.update(who, input);
  assert.equal((await pool.query("SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rowCount, 1);
});

test("interrupted setup with an authored card but no athlete profile keeps the card identity", async () => {
  const who = identity();
  const id = await owner();
  await link(who, id);
  await invite(id, "Saved athlete", "Saved team");
  const { service } = createService(new Map());
  const saved = await service.update(who, {
    athleteName: "Retry athlete", teamName: "", jerseyNumber: "", position: "", completeSetup: true,
  });
  assert.equal(saved.athleteName, "Saved athlete");
  assert.equal(saved.teamName, "Saved team");
  assert.equal(saved.sport, "soccer");
});

test("lost Clerk response leaves an authored card unchanged through relaunch and setup retry", async () => {
  const who = identity();
  const id = await owner();
  await link(who, id);
  await invite(id, "Authored athlete", "Authored team");
  await pool.query(`UPDATE athlete_invites SET photo_object_path='/objects/authored',
    card_appearance='{"name":"keep-authored"}', favorite_moment='Keep this',
    show_hype_card=true, show_stats=false, show_schedule=false, show_events=true, paused=false
    WHERE owner_clerk_user_id=$1`, [id]);
  const before = (await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rows;
  const metadata = new Map<string, Record<string, unknown>>([[id, { unrelatedFlag: true }]]);
  const interrupted = createNativeSupporterProfileService({
    getUser: async () => ({ unsafeMetadata: metadata.get(id) }),
    updateUser: async (_owner, value) => {
      metadata.set(id, structuredClone(value));
      throw new Error("Response lost after managed profile save");
    },
  });
  await assert.rejects(interrupted.update(who, {
    athleteName: "Retry athlete", teamName: "Retry team", jerseyNumber: "8", position: "Forward",
    sport: "softball", completeSetup: true,
  }), (error: any) => error.status === 503);
  assert.equal(metadata.get(id)?.athleteName, "Authored athlete");
  assert.deepEqual((await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rows, before);
  const { service } = createService(metadata);
  const reloaded = await service.load(who);
  assert.equal(reloaded.requiresSetup, false);
  assert.equal(reloaded.athleteName, "Authored athlete");
  assert.equal(reloaded.teamName, "Authored team");
  assert.equal(reloaded.sport, "soccer");
  await service.update(who, { ...reloaded, completeSetup: true });
  assert.equal(metadata.get(id)?.unrelatedFlag, true);
  assert.equal(metadata.get(id)?.seasonName, "Spring 2099");
  assert.deepEqual((await pool.query("SELECT * FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rows, before);
});

test("loading a saved profile with no committed card reports unfinished setup without creating a card", async () => {
  const who = identity();
  const id = await owner();
  await link(who, id);
  const { service, writes } = createService(new Map([[id, {
    athleteName: "Saved athlete", teamName: "Saved team", sport: "volleyball",
  }]]));
  const profile = await service.load(who);
  assert.equal(profile.athleteName, "Saved athlete");
  assert.equal(profile.requiresSetup, true);
  assert.equal(writes.length, 0);
  assert.equal((await pool.query("SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1", [id])).rowCount, 0);
});
