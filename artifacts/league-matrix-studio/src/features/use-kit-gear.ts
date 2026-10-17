import { getGetSoccerGearQueryKey, useGetSoccerGear } from '@workspace/api-client-react';

export const KIT_POLL_MS = 20_000;

export function kitGearKey(accountId: string | null | undefined) {
  return [...getGetSoccerGearQueryKey(), accountId ?? ''] as const;
}

/** Account-scoped saved kit query shared by parent and athlete screens. */
export function useKitGear(accountId: string | null | undefined, enabled = true) {
  return useGetSoccerGear({
    query: {
      enabled: Boolean(accountId) && enabled,
      queryKey: [...getGetSoccerGearQueryKey(), accountId ?? ''],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchInterval: KIT_POLL_MS,
      retry: false,
    },
  });
}
