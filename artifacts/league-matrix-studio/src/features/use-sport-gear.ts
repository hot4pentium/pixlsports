import { getGetSportGearForAthleteQueryKey, useGetSportGearForAthlete, type GearSport, type SportGearState } from '@workspace/api-client-react';

export function isGearSport(sport: string | null | undefined): sport is GearSport {
  return !!sport && ['baseball', 'basketball', 'football', 'soccer', 'softball', 'volleyball'].includes(sport);
}

export function useSportGear(accountId: string | null | undefined, sport: string | null | undefined, athleteName = '') {
  const supported = isGearSport(sport);
  const requestedSport = supported ? sport : 'football';
  const params = { sport: requestedSport, ...(athleteName.trim() ? { athleteName: athleteName.trim() } : {}) };
  return useGetSportGearForAthlete(params, {
    query: {
      queryKey: [...getGetSportGearForAthleteQueryKey(params), accountId ?? ''],
      enabled: Boolean(accountId) && supported,
      staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true,
      refetchInterval: 20_000, retry: false,
    },
  });
}

export function matchingSportGear(gear: SportGearState | undefined, name: string, sport: string | null | undefined) {
  return gear?.canSave && gear.sport === sport && gear.athleteName.trim().toLowerCase() === name.trim().toLowerCase() ? gear : null;
}
