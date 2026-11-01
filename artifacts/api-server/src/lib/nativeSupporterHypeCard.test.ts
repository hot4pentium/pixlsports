import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  correctNativeSupporterHypeCardIdentity,
  loadNativeSupporterHypeCard,
  loadNativeSupporterHypeCardPhoto,
  updateNativeSupporterHypeCard,
} from "./nativeSupporterHypeCard";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";

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

async function savedCardState(ownerIds: string[]) {
  const cards = await pool.query(
    "SELECT * FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[]) ORDER BY id",
    [ownerIds],
  );
  const snapshots = await pool.query(
    "SELECT * FROM hype_card_shares WHERE owner_clerk_user_id=ANY($1::text[]) ORDER BY id",
    [ownerIds],
  );
  return { cards: cards.rows, snapshots: snapshots.rows };
}

async function staleRepairFixture() {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await addInvite(linkedOwner, "Jordan", "Wolves", randomBytes(18).toString("base64url"));
  await pool.query(
    `UPDATE athlete_invites
     SET show_hype_card=false, show_stats=false, show_events=true, paused=true,
         favorite_moment='Keep this favorite', photo_object_path='private/original.webp',
         cutout_object_path='private/cutout.webp'
     WHERE owner_clerk_user_id=$1`,
    [linkedOwner],
  );
  await pool.query(
    `INSERT INTO hype_card_shares
       (owner_clerk_user_id, public_token, slug, title, manifest, share_mode, media_type, expires_at, athlete_name)
     VALUES ($1, $2, 'stale-repair-snapshot', 'Keep this snapshot',
             '{"headline":"Jordan","teamName":"Wolves"}'::jsonb,
             'card', 'image', NOW() + INTERVAL '1 day', 'Jordan')`,
    [linkedOwner, randomBytes(18).toString("base64url")],
  );
  let profile = { athleteName: "Casey", teamName: "Tigers" };
  const lookup = async () => ({ ...profile });
  const preview = await loadNativeSupporterHypeCard(who, lookup);
  assert.equal(preview.status, "mismatch");
  assert.ok(preview.correctionId);
  return {
    who,
    linkedOwner,
    correctionId: preview.correctionId,
    lookup,
    selectProfile(next: typeof profile) { profile = next; },
  };
}

after(async () => {
  await pool.query("DELETE FROM athlete_editor_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM hype_card_shares WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
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

test("native HYPE card reference reports a saved identity mismatch without exposing a public token", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await addInvite(linkedOwner, "Jordan", "Wolves", randomBytes(18).toString("base64url"));
  const savedInvite = await pool.query<{ id: string }>(
    "SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1",
    [linkedOwner],
  );

  const reference = await loadNativeSupporterHypeCard(who, async () => ({
    athleteName: "Jordan",
    teamName: "Tigers",
  }));

  assert.deepEqual(reference, {
    status: "mismatch",
    correctionId: savedInvite.rows[0]!.id,
    privatePreview: {
      athleteName: "Jordan",
      teamName: "Wolves",
      seasonName: "Spring 2099",
      favoriteMoment: null,
      hasPhoto: false,
    },
    settings: {
      showHypeCard: true,
      showStats: true,
      showEvents: false,
      paused: false,
      favoriteMoment: null,
    },
  });
  assert.equal("inviteToken" in reference, false);
});

test("owner can explicitly correct only the saved HYPE Card identity", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  const inviteToken = randomBytes(18).toString("base64url");
  await addInvite(linkedOwner, "Jordan", "Wolves", inviteToken);
  const selectedInvite = await pool.query<{ id: string }>(
    "SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1 AND public_token=$2",
    [linkedOwner, inviteToken],
  );
  await pool.query(
    `UPDATE athlete_invites
     SET show_hype_card=false, show_stats=false, show_events=true, paused=true,
         favorite_moment='Saved favorite', photo_object_path='private/photo.webp',
         cutout_object_path='private/cutout.webp'
     WHERE owner_clerk_user_id=$1 AND public_token=$2`,
    [linkedOwner, inviteToken],
  );
  const snapshotToken = randomBytes(18).toString("base64url");
  await pool.query(
    `INSERT INTO hype_card_shares
       (owner_clerk_user_id, public_token, slug, title, manifest, share_mode, media_type, expires_at, athlete_name)
     VALUES ($1, $2, 'saved-snapshot', 'Published snapshot', '{"headline":"Jordan"}'::jsonb,
             'card', 'image', NOW() + INTERVAL '1 day', 'Jordan')`,
    [linkedOwner, snapshotToken],
  );
  const lookup = async () => ({ athleteName: "Casey", teamName: "Tigers" });

  await assert.rejects(
    correctNativeSupporterHypeCardIdentity(who, {
      correctionId: selectedInvite.rows[0]!.id,
      confirm: false,
    }, lookup),
    (error: any) => error.status === 400,
  );
  const corrected = await correctNativeSupporterHypeCardIdentity(who, {
    correctionId: selectedInvite.rows[0]!.id,
    confirm: true,
  }, lookup);
  assert.deepEqual(corrected, { athleteName: "Casey", teamName: "Tigers" });

  const invite = await pool.query<{
    athlete_name: string;
    team_name: string;
    public_token: string;
    show_hype_card: boolean;
    show_stats: boolean;
    show_events: boolean;
    paused: boolean;
    favorite_moment: string | null;
    photo_object_path: string | null;
    cutout_object_path: string | null;
  }>(
    `SELECT athlete_name, team_name, public_token, show_hype_card, show_stats, show_events,
            paused, favorite_moment, photo_object_path, cutout_object_path
     FROM athlete_invites WHERE owner_clerk_user_id=$1 AND public_token=$2`,
    [linkedOwner, inviteToken],
  );
  assert.deepEqual(invite.rows[0], {
    athlete_name: "Casey",
    team_name: "Tigers",
    public_token: inviteToken,
    show_hype_card: false,
    show_stats: false,
    show_events: true,
    paused: true,
    favorite_moment: "Saved favorite",
    photo_object_path: "private/photo.webp",
    cutout_object_path: "private/cutout.webp",
  });
  const snapshot = await pool.query<{ athlete_name: string; title: string; manifest: unknown }>(
    `SELECT athlete_name, title, manifest
     FROM hype_card_shares WHERE owner_clerk_user_id=$1 AND public_token=$2`,
    [linkedOwner, snapshotToken],
  );
  assert.deepEqual(snapshot.rows[0], {
    athlete_name: "Jordan",
    title: "Published snapshot",
    manifest: { headline: "Jordan" },
  });
});

for (const changedAfterPreview of ["card", "profile", "profile without team"] as const) {
  test(`stale identity repair rejects an already matching ${changedAfterPreview} without changing saved data`, async () => {
    const fixture = await staleRepairFixture();
    if (changedAfterPreview === "card") {
      await pool.query(
        "UPDATE athlete_invites SET athlete_name='  CASEY ', team_name=' tIgErS ' WHERE id=$1",
        [fixture.correctionId],
      );
    } else {
      fixture.selectProfile({
        athleteName: "  JORDAN ",
        teamName: changedAfterPreview === "profile" ? " wOlVeS " : "  ",
      });
    }
    const before = await savedCardState([fixture.linkedOwner]);
    assert.equal(before.cards.length, 1);
    assert.equal(before.snapshots.length, 1);

    await assert.rejects(
      correctNativeSupporterHypeCardIdentity(fixture.who, {
        correctionId: fixture.correctionId,
        confirm: true,
      }, fixture.lookup),
      (error: unknown) => error instanceof NativeLinkError
        && error.status === 409
        && error.message === "This HYPE Card already matches the selected athlete.",
    );

    assert.deepEqual(await savedCardState([fixture.linkedOwner]), before,
      "rejection preserves newer identity, settings, photo paths, and published snapshots");
  });
}

for (const staleIdentifier of ["deleted", "replaced", "another owner's"] as const) {
  test(`identity repair cannot use a ${staleIdentifier} card identifier to update another card`, async () => {
    const fixture = await staleRepairFixture();
    let correctionId = fixture.correctionId;
    const ownerIds = [fixture.linkedOwner];
    if (staleIdentifier === "another owner's") {
      const unrelatedOwner = await owner();
      ownerIds.push(unrelatedOwner);
      await addInvite(unrelatedOwner, "Taylor", "Bears", randomBytes(18).toString("base64url"));
      const otherCard = await pool.query<{ id: string }>(
        "SELECT id FROM athlete_invites WHERE owner_clerk_user_id=$1",
        [unrelatedOwner],
      );
      correctionId = otherCard.rows[0]!.id;
    } else {
      await pool.query("DELETE FROM athlete_invites WHERE id=$1", [fixture.correctionId]);
      if (staleIdentifier === "replaced") {
        await addInvite(fixture.linkedOwner, "Morgan", "Falcons", randomBytes(18).toString("base64url"));
        await pool.query(
          `UPDATE athlete_invites SET show_stats=false, show_events=true,
             favorite_moment='Replacement favorite', photo_object_path='private/replacement.webp',
             cutout_object_path='private/replacement-cutout.webp'
           WHERE owner_clerk_user_id=$1`,
          [fixture.linkedOwner],
        );
      }
    }
    const before = await savedCardState(ownerIds);
    assert.equal(before.cards.length, staleIdentifier === "deleted" ? 0
      : staleIdentifier === "replaced" ? 1 : 2);
    assert.equal(before.snapshots.length, 1);

    await assert.rejects(
      correctNativeSupporterHypeCardIdentity(fixture.who, {
        correctionId,
        confirm: true,
      }, fixture.lookup),
      (error: unknown) => error instanceof NativeLinkError
        && error.status === 404
        && error.message === "No saved HYPE Card is available to correct.",
    );

    assert.deepEqual(await savedCardState(ownerIds), before,
      "rejection must not create a card or change any remaining card or published snapshot");
  });
}

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
