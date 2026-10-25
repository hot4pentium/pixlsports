import { useClerk } from '@clerk/react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { clearPrivateOfflineAccountData } from '@/features/offline-dashboard-cache';
import { clearCachedSupporterPhotoForAccount } from '@/features/supporter-photo-cache';

// Both sides of the route boundary must use the same account-scoped cache.
export const queryClient = new QueryClient();

export function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    return addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
        if (prevUserIdRef.current) {
          clearPrivateOfflineAccountData(window.localStorage, prevUserIdRef.current);
          void clearCachedSupporterPhotoForAccount(prevUserIdRef.current);
        }
      }
      prevUserIdRef.current = userId;
    });
  }, [addListener, queryClient]);

  return null;
}
