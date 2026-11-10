import type { PrimaryCardSide } from './hype-card-flip-model';

export function getOwnerHypeCardSides({
  isPublicActive,
  inviteAllowsStats,
  cardHasStats,
  inviteAllowsEvents,
  cardAllowsEvents,
}: {
  isPublicActive: boolean;
  inviteAllowsStats: boolean;
  cardHasStats: boolean;
  inviteAllowsEvents: boolean;
  cardAllowsEvents: boolean;
}): PrimaryCardSide[] {
  if (!isPublicActive) return ['front'];
  return [
    'front',
    'videos',
    ...(inviteAllowsStats && cardHasStats ? ['stats' as const] : []),
    ...(inviteAllowsEvents && cardAllowsEvents ? ['events' as const] : []),
  ];
}
