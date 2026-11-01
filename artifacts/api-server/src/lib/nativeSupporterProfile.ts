import { pool, type PoolClient } from "@workspace/db";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { getAdminClerkClient } from "./adminAccess";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";

export type NativeSupporterProfile = {
  athleteName: string;
  teamName: string;
  jerseyNumber: string;
  position: string;
};

type ProfileInput = NativeSupporterProfile;
type ClerkUser = { unsafeMetadata?: unknown };

type Dependencies = {
  getUser: (owner: string) => Promise<ClerkUser>;
  updateUser: (owner: string, metadata: Record<string, unknown>) => Promise<void>;
};

const clerkDependencies: Dependencies = {
  getUser: async (owner) => getAdminClerkClient().users.getUser(owner),
  updateUser: async (owner, unsafeMetadata) => {
    await getAdminClerkClient().users.updateUser(owner, { unsafeMetadata });
  },
};

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataString(metadata: Record<string, unknown>, key: keyof NativeSupporterProfile) {
  const value = metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function profileFromMetadata(value: unknown): NativeSupporterProfile {
  const metadata = metadataRecord(value);
  return {
    athleteName: metadataString(metadata, "athleteName"),
    teamName: metadataString(metadata, "teamName"),
    jerseyNumber: metadataString(metadata, "jerseyNumber").replace(/^#/, ""),
    position: metadataString(metadata, "position"),
  };
}

function normalizeProfile(input: ProfileInput): NativeSupporterProfile {
  return {
    athleteName: input.athleteName.trim(),
    teamName: input.teamName.trim(),
    jerseyNumber: input.jerseyNumber.trim().replace(/^#/, ""),
    position: input.position.trim(),
  };
}

function normalizedIdentity(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

async function linkedOwner(tx: PoolClient, identity: NativeIdentity, lock: "SHARE" | "UPDATE") {
  const { rows } = await tx.query<{ owner_clerk_user_id: string }>(
    `SELECT owner_clerk_user_id
     FROM native_account_links
     WHERE native_issuer=$1 AND native_subject=$2
     FOR ${lock}`,
    [identity.issuer, identity.subject],
  );
  const owner = rows[0]?.owner_clerk_user_id;
  if (!owner) {
    throw new NativeLinkError(409, "Connect your PIXL account before editing athlete details.");
  }
  await assertLinkableWebAccount(
    owner,
    tx,
    "This PIXL account can’t edit athlete details right now. Check its account status on PIXL Sports.",
  );
  return owner;
}

async function withLinkedOwner<T>(
  identity: NativeIdentity,
  lock: "SHARE" | "UPDATE",
  work: (tx: PoolClient, owner: string) => Promise<T>,
) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const owner = await linkedOwner(tx, identity, lock);
    const result = await work(tx, owner);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

function assertValidProfile(profile: NativeSupporterProfile) {
  if (!profile.athleteName) {
    throw new NativeLinkError(400, "Enter the athlete’s name to save the profile.");
  }
}

export function createNativeSupporterProfileService(dependencies: Dependencies = clerkDependencies) {
  return {
    async load(identity: NativeIdentity): Promise<NativeSupporterProfile> {
      return withLinkedOwner(identity, "SHARE", async (_tx, owner) => {
        const user = await dependencies.getUser(owner);
        return profileFromMetadata(user.unsafeMetadata);
      });
    },

    async update(identity: NativeIdentity, input: ProfileInput): Promise<NativeSupporterProfile> {
      const profile = normalizeProfile(input);
      assertValidProfile(profile);

      return withLinkedOwner(identity, "UPDATE", async (tx, owner) => {
        const user = await dependencies.getUser(owner);
        const oldMetadata = metadataRecord(user.unsafeMetadata);
        const oldProfile = profileFromMetadata(oldMetadata);

        // Keep an existing live HYPE Card aligned only when its identity still
        // matches the saved profile. This changes identity fields alone; all
        // visibility, pause, media, and publication settings remain untouched.
        const { rows: invites } = await tx.query<{
          public_token: string;
          athlete_name: string;
          team_name: string;
        }>(
          `SELECT public_token, athlete_name, team_name
           FROM athlete_invites
           WHERE owner_clerk_user_id=$1
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE`,
          [owner],
        );
        const invite = invites[0];
        const inviteMatchesSavedProfile = Boolean(
          invite
          && oldProfile.athleteName
          && normalizedIdentity(invite.athlete_name) === normalizedIdentity(oldProfile.athleteName)
          && (!oldProfile.teamName
            || normalizedIdentity(invite.team_name) === normalizedIdentity(oldProfile.teamName)),
        );
        if (invite && inviteMatchesSavedProfile) {
          const nextInviteTeam = profile.teamName || invite.team_name;
          if (
            invite.athlete_name !== profile.athleteName
            || invite.team_name !== nextInviteTeam
          ) {
            await tx.query(
              `UPDATE athlete_invites
               SET athlete_name=$1, team_name=$2
               WHERE owner_clerk_user_id=$3 AND public_token=$4`,
              [profile.athleteName, nextInviteTeam, owner, invite.public_token],
            );
          }
        }

        const nextMetadata = { ...oldMetadata, ...profile };
        try {
          await dependencies.updateUser(owner, nextMetadata);
        } catch {
          throw new NativeLinkError(503, "Your athlete profile could not be saved. Please try again.");
        }
        return profile;
      });
    },
  };
}

const profileService = createNativeSupporterProfileService();

export const loadNativeSupporterProfile = profileService.load;
export const updateNativeSupporterProfile = profileService.update;
