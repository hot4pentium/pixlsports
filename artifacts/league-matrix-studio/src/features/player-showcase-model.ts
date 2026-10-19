import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase();
}

/**
 * Match the selected athlete without requiring profile season or sport
 * metadata to be perfectly synchronized. Athlete and team are the primary
 * identity; sport and season disambiguate when multiple cards match.
 */
export function getShowcaseInvite(
  invites: readonly OwnedAthleteInvite[],
  profile: Pick<SupporterProfile, 'athleteName' | 'teamName' | 'seasonName' | 'sport'>,
) {
  const candidates = getShowcaseInviteCandidates(invites, profile);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;

  let narrowedCandidates = candidates;
  if (profile.sport) {
    const sportMatches = candidates.filter((invite) => invite.sport === profile.sport);
    if (sportMatches.length === 1) return sportMatches[0];
    if (sportMatches.length > 1) narrowedCandidates = sportMatches;
  }

  const seasonName = normalizeIdentity(profile.seasonName);
  if (!seasonName) return null;
  const seasonMatches = narrowedCandidates.filter((invite) => normalizeIdentity(invite.seasonName) === seasonName);
  return seasonMatches.length === 1 ? seasonMatches[0] : null;
}

/**
 * Return only the owner's cards for the selected athlete and team. These are
 * the only options that may be shown when sport and season cannot resolve a
 * single Showcase card.
 */
export function getShowcaseInviteCandidates(
  invites: readonly OwnedAthleteInvite[],
  profile: Pick<SupporterProfile, 'athleteName' | 'teamName'>,
) {
  const athleteName = normalizeIdentity(profile.athleteName);
  const teamName = normalizeIdentity(profile.teamName);
  if (!athleteName || !teamName) return [];

  return invites.filter((invite) =>
    normalizeIdentity(invite.athleteName) === athleteName
    && normalizeIdentity(invite.teamName) === teamName,
  );
}

/**
 * Return owned cards for an explicit reconnect choice only when the selected
 * profile has no exact athlete/team match. The caller must never infer that a
 * sole remaining card belongs to the selected athlete.
 */
export function getShowcaseInviteReconnectionCandidates<T extends Pick<OwnedAthleteInvite, 'inviteToken' | 'athleteName' | 'teamName'>>(
  invites: readonly T[],
  profile: Pick<SupporterProfile, 'athleteName' | 'teamName'>,
) {
  const athleteName = normalizeIdentity(profile.athleteName);
  const teamName = normalizeIdentity(profile.teamName);
  if (!athleteName || !teamName) return [];
  if (invites.some((invite) =>
    normalizeIdentity(invite.athleteName) === athleteName
    && normalizeIdentity(invite.teamName) === teamName,
  )) return [];
  return [...invites];
}
