import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  createNativeSupporterProfileService,
  type NativeSupporterProfile,
} from "./nativeSupporterProfile";
import type { NativeIdentity } from "./nativeIdentity";

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
