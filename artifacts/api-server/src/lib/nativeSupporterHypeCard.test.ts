import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  loadNativeSupporterHypeCard,
  loadNativeSupporterHypeCardPhoto,
  updateNativeSupporterHypeCard,
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
  await pool.query("DELETE FROM athlete_editor_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [nativeSubjects]);
  await pool.query("DELETE FROM stat_tracker_shares WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
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

  assert.deepEqual(reference, {
    status: "available",
    inviteToken: selectedToken,
    settings: {
      showHypeCard: true,
      showStats: true,
      showEvents: false,
      paused: false,
      favoriteMoment: null,
    },
  });
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
    settings: {
      showHypeCard: false,
      showStats: true,
      showEvents: false,
      paused: false,
      favoriteMoment: "A great team play",
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

test("native owner edits require confirmation before publishing and close live tracker shares when paused", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  const inviteToken = randomBytes(18).toString("base64url");
  await addInvite(linkedOwner, "Jordan", "Tigers", inviteToken);
  await pool.query(
    `UPDATE athlete_invites SET show_hype_card=false, show_stats=false, show_events=true,
       favorite_moment='Before' WHERE owner_clerk_user_id=$1 AND public_token=$2`,
    [linkedOwner, inviteToken],
  );
  const lookup = async () => ({ athleteName: "Jordan", teamName: "Tigers" });
  const base = {
    showHypeCard: true,
    showStats: true,
    showEvents: false,
    paused: false,
    favoriteMoment: "A great team play",
  };

  await assert.rejects(
    updateNativeSupporterHypeCard(who, { ...base, confirmPublish: false }, lookup),
    (error: any) => error.status === 400,
  );
  const stillPrivate = await loadNativeSupporterHypeCard(who, lookup);
  assert.equal(stillPrivate.status, "hidden");
  assert.equal(stillPrivate.settings?.showHypeCard, false);
  assert.equal(stillPrivate.settings?.favoriteMoment, "Before");
  assert.equal("inviteToken" in stillPrivate, false);

  const saved = await updateNativeSupporterHypeCard(who, { ...base, confirmPublish: true }, lookup);
  assert.deepEqual(saved, {
    showHypeCard: true,
    showStats: true,
    showEvents: false,
    paused: false,
    favoriteMoment: "A great team play",
  });
  const published = await loadNativeSupporterHypeCard(who, lookup);
  assert.equal(published.status, "available");
  assert.equal(published.inviteToken, inviteToken);
  assert.equal(published.settings?.showEvents, false);

  const liveShare = await pool.query<{ id: string }>(
    `INSERT INTO stat_tracker_shares
      (owner_clerk_user_id, game_id, athlete_name, team_name, game, expires_at)
     VALUES ($1, $2, 'Jordan', 'Tigers', '{}'::jsonb, NOW() + INTERVAL '1 day')
     RETURNING id`,
    [linkedOwner, randomUUID()],
  );
  await pool.query(
    "UPDATE athlete_invites SET live_tracker_share_token=$2 WHERE owner_clerk_user_id=$1",
    [linkedOwner, liveShare.rows[0]!.id],
  );
  const pausedSettings = await updateNativeSupporterHypeCard(who, {
    showHypeCard: true,
    showStats: true,
    showEvents: false,
    paused: true,
    favoriteMoment: "A great team play",
    confirmPublish: false,
  }, lookup);
  assert.equal(pausedSettings.paused, true);
  const paused = await loadNativeSupporterHypeCard(who, lookup);
  assert.equal(paused.status, "hidden");
  assert.equal(paused.settings?.paused, true);
  assert.equal("inviteToken" in paused, false, "pausing removes the public share reference");
  assert.equal(
    (await pool.query("SELECT id FROM stat_tracker_shares WHERE id=$1", [liveShare.rows[0]!.id])).rowCount,
    0,
    "pausing also closes the active live tracker share",
  );
  await assert.rejects(
    updateNativeSupporterHypeCard(who, {
      showHypeCard: true,
      showStats: true,
      showEvents: false,
      paused: false,
      favoriteMoment: "A great team play",
      confirmPublish: false,
    }, lookup),
    (error: any) => error.status === 400,
    "resuming a public card requires explicit confirmation",
  );
  const resumed = await updateNativeSupporterHypeCard(who, {
    showHypeCard: true,
    showStats: true,
    showEvents: false,
    paused: false,
    favoriteMoment: "A great team play",
    confirmPublish: true,
  }, lookup);
  assert.equal(resumed.paused, false);
  assert.equal((await loadNativeSupporterHypeCard(who, lookup)).status, "available");
});

test("native HYPE Card publishing controls reject a dedicated athlete editor identity", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await addInvite(linkedOwner, "Jordan", "Tigers", randomBytes(18).toString("base64url"));
  const invite = await pool.query<{ id: string }>(
    "SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1",
    [linkedOwner],
  );
  await pool.query(
    `INSERT INTO athlete_editor_access
      (owner_clerk_user_id, athlete_invite_id, athlete_email, athlete_clerk_user_id, existing_account, status)
     VALUES ($1, $2, 'athlete@example.com', $1, false, 'active')`,
    [linkedOwner, invite.rows[0]!.id],
  );

  await assert.rejects(
    updateNativeSupporterHypeCard(who, {
      showHypeCard: false,
      showStats: true,
      showEvents: true,
      paused: false,
      favoriteMoment: null,
      confirmPublish: false,
    }, async () => ({ athleteName: "Jordan", teamName: "Tigers" })),
    (error: any) => error.status === 423,
  );
  const persisted = await pool.query<{ show_hype_card: boolean }>(
    "SELECT show_hype_card FROM athlete_invites WHERE owner_clerk_user_id=$1",
    [linkedOwner],
  );
  assert.equal(persisted.rows[0]?.show_hype_card, true);
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
