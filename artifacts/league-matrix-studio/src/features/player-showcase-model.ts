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
  const athleteName = normalizeIdentity(profile.athleteName);
  const teamName = normalizeIdentity(profile.teamName);
  if (!athleteName || !teamName) return null;

  const candidates = invites.filter((invite) =>
    normalizeIdentity(invite.athleteName) === athleteName
    && normalizeIdentity(invite.teamName) === teamName,
  );
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
