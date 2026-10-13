import type { OwnedAthleteInvite, SoccerGearState } from '@workspace/api-client-react';
import type { AthleteLockerCardStatus } from './athlete-locker-types';

export type AthleteLockerRewardId =
  | 'match-ball'
  | 'event-bag'
  | 'tactics-board'
  | 'stripe-jersey'
  | 'speed-cleats';

export interface AthleteLockerReward {
  id: AthleteLockerRewardId;
  label: string;
  requirement: string;
  earned: boolean;
}

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

export function getAthleteLockerRewards(
  progress: SoccerGearState['progress'] | null | undefined,
): AthleteLockerReward[] {
  const activeWeeks = progress?.activeWeeks ?? 0;
  const eventCards = progress?.eventCardsCreated ?? 0;
  const trackerGames = progress?.trackerGamesCompleted ?? 0;
  return [
    {
      id: 'match-ball',
      label: 'Match ball',
      requirement: 'Return during a new week',
      earned: activeWeeks >= 1,
    },
    {
      id: 'event-bag',
      label: 'Event bag',
      requirement: 'Create your first Event Card',
      earned: eventCards >= 1,
    },
    {
      id: 'tactics-board',
      label: 'Tactics board',
      requirement: 'Save your first completed tracker game',
      earned: trackerGames >= 1,
    },
    {
      id: 'stripe-jersey',
      label: 'Stripe jersey',
      requirement: 'Create 10 Event Cards',
      earned: eventCards >= 10,
    },
    {
      id: 'speed-cleats',
      label: 'Speed cleats',
      requirement: 'Save 5 completed tracker games',
      earned: trackerGames >= 5,
    },
  ];
}
