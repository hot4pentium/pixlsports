import { readNativeOwnerMetadata } from "./nativeOwnerMetadata";
import { pool } from "@workspace/db";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";

export type NativeHypeCardReference = {
  status: "unlinked" | "no-card" | "hidden" | "mismatch" | "available";
  inviteToken?: string;
  correctionId?: string;
  privatePreview?: NativePrivateHypeCard;
  settings?: NativeHypeCardSettings;
};

export type NativeHypeCardSettings = {
  showHypeCard: boolean;
  showStats: boolean;
  showEvents: boolean;
  paused: boolean;
  favoriteMoment: string | null;
};

export type NativeHypeCardSettingsUpdate = NativeHypeCardSettings & {
  confirmPublish: boolean;
};

export type NativePrivateHypeCard = {
  athleteName: string;
  teamName: string;
  seasonName: string;
  favoriteMoment: string | null;
  hasPhoto: boolean;
};

export type SelectedAthlete = {
  athleteName: string;
  teamName: string;
};

export type NativeHypeCardIdentityCorrection = {
  correctionId: string;
  confirm: boolean;
};

export type NativeHypeCardIdentityCorrectionResult = {
  athleteName: string;
  teamName: string;
};

type ProfileLookup = (ownerClerkUserId: string) => Promise<SelectedAthlete>;
type PhotoRole = "photo" | "cutout";
const photoStorage = new ObjectStorageService();
const normalize = (value: string) => value.trim().toLocaleLowerCase("en-US");

function settingsFor(invite: {
  show_hype_card: boolean;
  show_stats: boolean;
  show_events: boolean;
  paused: boolean;
  favorite_moment: string | null;
}): NativeHypeCardSettings {
  return {
    showHypeCard: invite.show_hype_card,
    showStats: invite.show_stats,
    showEvents: invite.show_events,
    paused: invite.paused,
    favoriteMoment: invite.favorite_moment,
  };
}

async function selectedProfile(ownerClerkUserId: string): Promise<SelectedAthlete> {
  const user = await readNativeOwnerMetadata(ownerClerkUserId);
  const metadata = user.unsafeMetadata;
  return {
    athleteName: typeof metadata.athleteName === "string" ? metadata.athleteName.trim() : "",
    teamName: typeof metadata.teamName === "string" ? metadata.teamName.trim() : "",
  };
}

/**
 * Resolve a public HYPE Card token only for the explicitly selected athlete on
 * the verified web account linked to this native Clerk identity.
 */
export async function loadNativeSupporterHypeCard(
  identity: NativeIdentity,
  lookupProfile: ProfileLookup = selectedProfile,
): Promise<NativeHypeCardReference> {
  const linked = await pool.query<{ owner_clerk_user_id: string }>(
    `SELECT owner_clerk_user_id
     FROM native_account_links
     WHERE native_issuer=$1 AND native_subject=$2
     LIMIT 1`,
    [identity.issuer, identity.subject],
  );
  const owner = linked.rows[0]?.owner_clerk_user_id;
  if (!owner) return { status: "unlinked" };

  await assertLinkableWebAccount(owner);
  const profile = await lookupProfile(owner);
  if (!profile.athleteName) return { status: "no-card" };

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const currentLink = await tx.query<{ owner_clerk_user_id: string }>(
      `SELECT owner_clerk_user_id
       FROM native_account_links
       WHERE native_issuer=$1 AND native_subject=$2
       FOR SHARE`,
      [identity.issuer, identity.subject],
    );
    if (currentLink.rows[0]?.owner_clerk_user_id !== owner) {
      await tx.query("COMMIT");
      return { status: "unlinked" };
    }

    await assertLinkableWebAccount(
      owner,
      tx,
      "This PIXL account can’t provide HYPE Card access right now. Check its account status on PIXL Sports.",
    );

    const invites = await tx.query<{
      id: string;
      public_token: string;
      athlete_name: string;
      team_name: string;
      season_name: string;
      paused: boolean;
      show_hype_card: boolean;
      show_stats: boolean;
      show_events: boolean;
      favorite_moment: string | null;
      photo_object_path: string | null;
      cutout_object_path: string | null;
    }>(
      `SELECT id, public_token, athlete_name, team_name, season_name, paused, show_hype_card,
              show_stats, show_events,
              favorite_moment, photo_object_path, cutout_object_path
       FROM athlete_invites
       WHERE owner_clerk_user_id=$1
       ORDER BY created_at DESC`,
      [owner],
    );
    const athlete = normalize(profile.athleteName);
    const team = normalize(profile.teamName);
    const matches = invites.rows.filter((candidate) =>
      normalize(candidate.athlete_name) === athlete
      && (!team || normalize(candidate.team_name) === team),
    );

    if (!team && new Set(matches.map((candidate) => normalize(candidate.team_name))).size > 1) {
      await tx.query("COMMIT");
      return { status: "no-card" };
    }
    const invite = matches[0];
    if (!invite) {
      const latestInvite = invites.rows[0];
      await tx.query("COMMIT");
      if (!latestInvite) return { status: "no-card" };
      return {
        status: "mismatch",
        correctionId: latestInvite.id,
        privatePreview: {
          athleteName: latestInvite.athlete_name,
          teamName: latestInvite.team_name,
          seasonName: latestInvite.season_name,
          favoriteMoment: latestInvite.favorite_moment,
          hasPhoto: Boolean(latestInvite.cutout_object_path || latestInvite.photo_object_path),
        },
        settings: settingsFor(latestInvite),
      };
    }
    await tx.query("COMMIT");
    if (invite.paused || !invite.show_hype_card) {
      return {
        status: "hidden",
        privatePreview: {
          athleteName: invite.athlete_name,
          teamName: invite.team_name,
          seasonName: invite.season_name,
          favoriteMoment: invite.favorite_moment,
          hasPhoto: Boolean(invite.cutout_object_path || invite.photo_object_path),
        },
        settings: settingsFor(invite),
      };
    }
    return {
      status: "available",
      inviteToken: invite.public_token,
      settings: settingsFor(invite),
    };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

/**
 * Correct only the newest saved HYPE Card's identity after an explicit owner
 * confirmation. Artwork, snapshots, visibility, pause, and media are untouched.
 */
export async function correctNativeSupporterHypeCardIdentity(
  identity: NativeIdentity,
  correction: NativeHypeCardIdentityCorrection,
  lookupProfile: ProfileLookup = selectedProfile,
): Promise<NativeHypeCardIdentityCorrectionResult> {
  if (!correction.confirm) {
    throw new NativeLinkError(400, "Confirm that this HYPE Card belongs to the selected athlete.");
  }

  const linked = await pool.query<{ owner_clerk_user_id: string }>(
    `SELECT owner_clerk_user_id
     FROM native_account_links
     WHERE native_issuer=$1 AND native_subject=$2
     LIMIT 1`,
    [identity.issuer, identity.subject],
  );
  const owner = linked.rows[0]?.owner_clerk_user_id;
  if (!owner) throw new NativeLinkError(404, "The linked PIXL account is unavailable.");
  await assertLinkableWebAccount(
    owner,
    undefined,
    "This PIXL account can’t update HYPE Card identity right now. Check its account status on PIXL Sports.",
  );
  const profile = await lookupProfile(owner);
  if (!profile.athleteName.trim()) {
    throw new NativeLinkError(409, "Select an athlete in the linked PIXL account first.");
  }

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const currentLink = await tx.query<{ owner_clerk_user_id: string }>(
      `SELECT owner_clerk_user_id
       FROM native_account_links
       WHERE native_issuer=$1 AND native_subject=$2
       FOR SHARE`,
      [identity.issuer, identity.subject],
    );
    if (currentLink.rows[0]?.owner_clerk_user_id !== owner) {
      throw new NativeLinkError(404, "The linked PIXL account is unavailable.");
    }
    await assertLinkableWebAccount(
      owner,
      tx,
      "This PIXL account can’t update HYPE Card identity right now. Check its account status on PIXL Sports.",
    );
    const { rows } = await tx.query<{
      id: string;
      athlete_name: string;
      team_name: string;
    }>(
      `SELECT id, athlete_name, team_name
       FROM athlete_invites
       WHERE owner_clerk_user_id=$1 AND id=$2
       FOR UPDATE`,
      [owner, correction.correctionId],
    );
    const invite = rows[0];
    if (!invite) throw new NativeLinkError(404, "No saved HYPE Card is available to correct.");
    if (
      normalize(invite.athlete_name) === normalize(profile.athleteName)
      && (!profile.teamName.trim() || normalize(invite.team_name) === normalize(profile.teamName))
    ) {
      throw new NativeLinkError(409, "This HYPE Card already matches the selected athlete.");
    }

    const athleteName = profile.athleteName.trim();
    const teamName = profile.teamName.trim() || invite.team_name;
    await tx.query(
      `UPDATE athlete_invites
       SET athlete_name=$1, team_name=$2
       WHERE id=$3 AND owner_clerk_user_id=$4`,
      [athleteName, teamName, invite.id, owner],
    );
    await tx.query("COMMIT");
    return { athleteName, teamName };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

/**
 * Update only the selected athlete's HYPE Card controls. A private or paused
 * card requires an explicit confirmation before this write can make it public.
 */
export async function updateNativeSupporterHypeCard(
  identity: NativeIdentity,
  update: NativeHypeCardSettingsUpdate,
  lookupProfile: ProfileLookup = selectedProfile,
): Promise<NativeHypeCardSettings> {
  const linked = await pool.query<{ owner_clerk_user_id: string }>(
    `SELECT owner_clerk_user_id
     FROM native_account_links
     WHERE native_issuer=$1 AND native_subject=$2
     LIMIT 1`,
    [identity.issuer, identity.subject],
  );
  const owner = linked.rows[0]?.owner_clerk_user_id;
  if (!owner) throw new NativeLinkError(404, "The linked PIXL account is unavailable.");

  await assertLinkableWebAccount(
    owner,
    undefined,
    "This PIXL account can’t manage HYPE Card privacy right now. Check its account status on PIXL Sports.",
  );
  const profile = await lookupProfile(owner);
  if (!profile.athleteName) {
    throw new NativeLinkError(404, "Select an athlete in the linked PIXL account first.");
  }

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const currentLink = await tx.query<{ owner_clerk_user_id: string }>(
      `SELECT owner_clerk_user_id
       FROM native_account_links
       WHERE native_issuer=$1 AND native_subject=$2
       FOR SHARE`,
      [identity.issuer, identity.subject],
    );
    if (currentLink.rows[0]?.owner_clerk_user_id !== owner) {
      throw new NativeLinkError(404, "The linked PIXL account is unavailable.");
    }
    await assertLinkableWebAccount(
      owner,
      tx,
      "This PIXL account can’t manage HYPE Card privacy right now. Check its account status on PIXL Sports.",
    );

    const candidates = await tx.query<{
      id: string;
      athlete_name: string;
      team_name: string;
    }>(
      `SELECT id, athlete_name, team_name
       FROM athlete_invites
       WHERE owner_clerk_user_id=$1
       ORDER BY created_at DESC`,
      [owner],
    );
    const athlete = normalize(profile.athleteName);
    const team = normalize(profile.teamName);
    const matches = candidates.rows.filter((candidate) =>
      normalize(candidate.athlete_name) === athlete
      && (!team || normalize(candidate.team_name) === team),
    );
    if (!team && new Set(matches.map((candidate) => normalize(candidate.team_name))).size > 1) {
      throw new NativeLinkError(409, "Choose a team for the selected athlete before editing this HYPE Card.");
    }
    const match = matches[0];
    if (!match) throw new NativeLinkError(404, "No HYPE Card matches the selected athlete and team.");

    const selected = await tx.query<{
      show_hype_card: boolean;
      show_stats: boolean;
      show_events: boolean;
      paused: boolean;
      favorite_moment: string | null;
      live_tracker_share_token: string | null;
    }>(
      `SELECT show_hype_card, show_stats, show_events, paused,
              favorite_moment, live_tracker_share_token
       FROM athlete_invites
       WHERE id=$1 AND owner_clerk_user_id=$2
       FOR UPDATE`,
      [match.id, owner],
    );
    const current = selected.rows[0];
    if (!current) throw new NativeLinkError(404, "No HYPE Card matches the selected athlete and team.");

    const becomesPublic = update.showHypeCard && !update.paused
      && (!current.show_hype_card || current.paused);
    if (becomesPublic && !update.confirmPublish) {
      throw new NativeLinkError(400, "Confirm that you want to make this HYPE Card public.");
    }

    const favoriteMoment = update.favoriteMoment?.trim() || null;
    await tx.query(
      `UPDATE athlete_invites
       SET show_hype_card=$1, show_stats=$2, show_events=$3, paused=$4,
           favorite_moment=$5, live_tracker_share_token=CASE WHEN $4 THEN NULL ELSE live_tracker_share_token END,
           updated_at=NOW()
       WHERE id=$6 AND owner_clerk_user_id=$7`,
      [
        update.showHypeCard,
        update.showStats,
        update.showEvents,
        update.paused,
        favoriteMoment,
        match.id,
        owner,
      ],
    );
    if (update.paused && current.live_tracker_share_token) {
      await tx.query(
        "DELETE FROM stat_tracker_shares WHERE id=$1 AND owner_clerk_user_id=$2",
        [current.live_tracker_share_token, owner],
      );
    }
    await tx.query("COMMIT");
    return {
      showHypeCard: update.showHypeCard,
      showStats: update.showStats,
      showEvents: update.showEvents,
      paused: update.paused,
      favoriteMoment,
    };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

/**
 * Load a hidden card photo only for the current native link and selected athlete.
 * The owner preview never receives a public photo URL or invite token.
 */
export async function loadNativeSupporterHypeCardPhoto(
  identity: NativeIdentity,
  role: PhotoRole,
  lookupProfile: ProfileLookup = selectedProfile,
): Promise<Buffer | null> {
  const linked = await pool.query<{ owner_clerk_user_id: string }>(
    `SELECT owner_clerk_user_id
     FROM native_account_links
     WHERE native_issuer=$1 AND native_subject=$2
     LIMIT 1`,
    [identity.issuer, identity.subject],
  );
  const owner = linked.rows[0]?.owner_clerk_user_id;
  if (!owner) return null;
  const profile = await lookupProfile(owner);
  if (!profile.athleteName) return null;

  const tx = await pool.connect();
  let objectPath: string | null = null;
  try {
    await tx.query("BEGIN");
    const currentLink = await tx.query<{ owner_clerk_user_id: string }>(
      `SELECT owner_clerk_user_id
       FROM native_account_links
       WHERE native_issuer=$1 AND native_subject=$2
       FOR SHARE`,
      [identity.issuer, identity.subject],
    );
    if (currentLink.rows[0]?.owner_clerk_user_id !== owner) {
      await tx.query("COMMIT");
      return null;
    }
    await assertLinkableWebAccount(
      owner,
      tx,
      "This PIXL account can’t provide HYPE Card access right now. Check its account status on PIXL Sports.",
    );

    const invites = await tx.query<{
      athlete_name: string;
      team_name: string;
      paused: boolean;
      show_hype_card: boolean;
      photo_object_path: string | null;
      cutout_object_path: string | null;
    }>(
      `SELECT athlete_name, team_name, paused, show_hype_card,
              photo_object_path, cutout_object_path
       FROM athlete_invites
       WHERE owner_clerk_user_id=$1
       FOR SHARE`,
      [owner],
    );
    const normalize = (value: string) => value.trim().toLocaleLowerCase("en-US");
    const athlete = normalize(profile.athleteName);
    const team = normalize(profile.teamName);
    const matches = invites.rows.filter((candidate) =>
      normalize(candidate.athlete_name) === athlete
      && (!team || normalize(candidate.team_name) === team),
    );
    if (!team && new Set(matches.map((candidate) => normalize(candidate.team_name))).size > 1) {
      await tx.query("COMMIT");
      return null;
    }
    const invite = matches[0];
    if (!invite || (!invite.paused && invite.show_hype_card)) {
      await tx.query("COMMIT");
      return null;
    }
    objectPath = role === "cutout"
      ? invite.cutout_object_path ?? invite.photo_object_path
      : invite.photo_object_path;
    await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }

  if (!objectPath) return null;
  try {
    const [contents] = await (await photoStorage.getObjectEntityFile(objectPath)).download();
    return contents;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return null;
    throw error;
  }
}
