import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase();
}

/**
 * Match the selected athlete without requiring profile season metadata to be
 * perfectly synchronized. Season identifies a card when more than one card
 * otherwise matches; it is not required when the athlete/team/sport match is
 * unique.
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
    && normalizeIdentity(invite.teamName) === teamName
    && (!profile.sport || invite.sport === profile.sport),
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;

  const seasonName = normalizeIdentity(profile.seasonName);
  if (!seasonName) return null;
  const seasonMatches = candidates.filter((invite) => normalizeIdentity(invite.seasonName) === seasonName);
  return seasonMatches.length === 1 ? seasonMatches[0] : null;
}
