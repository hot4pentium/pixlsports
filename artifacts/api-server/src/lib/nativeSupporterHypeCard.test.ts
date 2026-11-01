import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  loadNativeSupporterHypeCard,
  loadNativeSupporterHypeCardPhoto,
} from "./nativeSupporterHypeCard";
import type { NativeIdentity } from "./nativeIdentity";

const owners: string[] = [];
const nativeSubjects: string[] = [];

function identity(): NativeIdentity {
  const subject = `user_nativeHype${randomUUID().replaceAll("-", "")}`;
  nativeSubjects.push(subject);
  return { issuer: "https://native-hype-fixture.clerk.accounts.dev", subject };
}

async function owner() {
  const ownerClerkUserId = `user_webHype${randomUUID().replaceAll("-", "")}`;
  owners.push(ownerClerkUserId);
  await pool.query(`INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free','active')`, [ownerClerkUserId]);
  return ownerClerkUserId;
}

async function link(who: NativeIdentity, ownerClerkUserId: string) {
  await pool.query(`INSERT INTO native_account_links
    (native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES ($1,$2,$3,'HYPE card test account')`,
  [who.issuer, who.subject, ownerClerkUserId]);
}

async function addInvite(ownerClerkUserId: string, athlete: string, team: string, token: string) {
  await pool.query(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
    VALUES ($1,$2,$3,$4,'Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York')`,
  [ownerClerkUserId, token, athlete, team]);
}

after(async () => {
  await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [nativeSubjects]);
  await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

test("native HYPE card reference matches the linked account's selected athlete and team", async () => {
  const who = identity();
  const linkedOwner = await owner();
  const unrelatedOwner = await owner();
  await link(who, linkedOwner);
  const selectedToken = randomBytes(18).toString("base64url");
  await addInvite(linkedOwner, " Jordan ", " Tigers ", selectedToken);
  await addInvite(unrelatedOwner, "Jordan", "Wolves", randomBytes(18).toString("base64url"));

  const reference = await loadNativeSupporterHypeCard(who, async (ownerId) => {
    assert.equal(ownerId, linkedOwner);
    return { athleteName: "jordan", teamName: "tigers" };
  });

  assert.deepEqual(reference, { status: "available", inviteToken: selectedToken });
});

test("native HYPE card reference with no selected athlete exposes no saved invite", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await addInvite(linkedOwner, "Jordan", "Wolves", randomBytes(18).toString("base64url"));

  const reference = await loadNativeSupporterHypeCard(who, async () => ({
    athleteName: "Jordan",
    teamName: "Tigers",
  }));

  assert.deepEqual(reference, { status: "no-card" });
});

test("linked owners can preview a hidden HYPE Card without receiving its public token", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  const inviteToken = randomBytes(18).toString("base64url");
  await addInvite(linkedOwner, "Jordan", "Tigers", inviteToken);
  await pool.query(
    "UPDATE athlete_invites SET show_hype_card=false, favorite_moment='A great team play' WHERE owner_clerk_user_id=$1",
    [linkedOwner],
  );

  const reference = await loadNativeSupporterHypeCard(who, async () => ({
    athleteName: "Jordan",
    teamName: "Tigers",
  }));

  assert.deepEqual(reference, {
    status: "hidden",
    privatePreview: {
      athleteName: "Jordan",
      teamName: "Tigers",
      seasonName: "Spring 2099",
      favoriteMoment: "A great team play",
      hasPhoto: false,
    },
  });
  assert.equal("inviteToken" in reference, false, "a hidden card does not expose a public share token");
  const persisted = await pool.query<{
    show_hype_card: boolean;
    public_token: string;
    invite_count: string;
  }>(`SELECT show_hype_card, public_token,
        (SELECT COUNT(*)::text FROM athlete_invites WHERE owner_clerk_user_id=$1) AS invite_count
      FROM athlete_invites WHERE owner_clerk_user_id=$1`, [linkedOwner]);
  assert.equal(persisted.rows[0]?.show_hype_card, false, "previewing does not change visibility");
  assert.equal(persisted.rows[0]?.public_token, inviteToken, "previewing does not rotate or create a share");
  assert.equal(persisted.rows[0]?.invite_count, "1", "previewing does not create another invite");
});

test("unlinked native identities cannot resolve a HYPE card", async () => {
  let profileRequested = false;
  const reference = await loadNativeSupporterHypeCard(identity(), async () => {
    profileRequested = true;
    return { athleteName: "Jordan", teamName: "Tigers" };
  });
  assert.deepEqual(reference, { status: "unlinked" });
  assert.equal(profileRequested, false);
});

test("revoked native account links cannot load a private HYPE Card photo", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=$1", [who.subject]);
  let profileRequested = false;

  const photo = await loadNativeSupporterHypeCardPhoto(who, "cutout", async () => {
    profileRequested = true;
    return { athleteName: "Jordan", teamName: "Tigers" };
  });

  assert.equal(photo, null);
  assert.equal(profileRequested, false, "the revoked link is checked before loading the selected athlete");
});
