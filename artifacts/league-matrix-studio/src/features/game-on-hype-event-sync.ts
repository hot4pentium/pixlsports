import type { QueryClient } from '@tanstack/react-query';

/** Saved Event Cards also supply the Hype Card's Events side. */
export function invalidateHypeCardEvents(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => {
      const path = queryKey[0];
      return typeof path === 'string'
        && (path === '/api/athlete-invites' || path.startsWith('/api/athlete-invites/'));
    },
  });
}