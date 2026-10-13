import type { OwnedAthleteInvite, SoccerGearState } from '@workspace/api-client-react';
import type { AthleteLockerCardStatus } from './athlete-locker-types';

function normalizeAthleteName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function isSoccerGearForAthlete(
  gear: SoccerGearState | null | undefined,
  athleteName: string,
  sport: string | null,
): gear is SoccerGearState {
  const selectedName = normalizeAthleteName(athleteName);
  return sport === 'soccer'
    && Boolean(gear?.canSave)
    && Boolean(selectedName)
    && normalizeAthleteName(gear?.athleteName ?? '') === selectedName;
}

export function canOpenAthleteLockerCard(
  status: AthleteLockerCardStatus,
  card: OwnedAthleteInvite | null,
  href: string | null,
): boolean {
  return status === 'ready'
    && Boolean(card)
    && Boolean(href?.trim())
    && !card?.paused
    && card?.showHypeCard === true;
}
