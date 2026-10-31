import { createClerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import type { NativeIdentity } from "./nativeIdentity";

export type NativeHypeCardReference = {
  status: "unlinked" | "no-card" | "hidden" | "available";
  inviteToken?: string;
};

export type SelectedAthlete = {
  athleteName: string;
  teamName: string;
};

type ProfileLookup = (ownerClerkUserId: string) => Promise<SelectedAthlete>;

async function selectedProfile(ownerClerkUserId: string): Promise<SelectedAthlete> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(ownerClerkUserId);
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
      public_token: string;
      athlete_name: string;
      team_name: string;
      paused: boolean;
      show_hype_card: boolean;
    }>(
      `SELECT public_token, athlete_name, team_name, paused, show_hype_card
       FROM athlete_invites
       WHERE owner_clerk_user_id=$1
       ORDER BY created_at DESC`,
      [owner],
    );
    const normalize = (value: string) => value.trim().toLocaleLowerCase("en-US");
    const athlete = normalize(profile.athleteName);
    const team = normalize(profile.teamName);
    const matches = invites.rows.filter((candidate) =>
      normalize(candidate.athlete_name) === athlete
      && (!team || normalize(candidate.team_name) === team),
    );

    await tx.query("COMMIT");
    if (!team && new Set(matches.map((candidate) => normalize(candidate.team_name))).size > 1) {
      return { status: "no-card" };
    }
    const invite = matches[0];
    if (!invite) return { status: "no-card" };
    if (invite.paused || !invite.show_hype_card) return { status: "hidden" };
    return { status: "available", inviteToken: invite.public_token };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
