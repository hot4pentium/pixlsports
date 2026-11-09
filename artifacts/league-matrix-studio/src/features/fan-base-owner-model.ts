import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';
import { getShowcaseInvite } from './player-showcase-model';

export function resolveFanBaseInvite(
  ownedInvites: readonly OwnedAthleteInvite[],
  profile: Pick<SupporterProfile, 'athleteName' | 'teamName' | 'sport' | 'seasonName'>,
  requestedToken: string,
) {
  // An explicit destination must never silently switch to a different card.
  if (requestedToken) return ownedInvites.find(card => card.inviteToken === requestedToken) ?? null;
  return getShowcaseInvite(ownedInvites, profile);
}
