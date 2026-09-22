import type { QueryClient } from '@tanstack/react-query';
import { getGetSupporterPhotoQueryKey } from '@workspace/api-client-react';

export function clearSupporterPhotoCache(queryClient: QueryClient) {
  queryClient.setQueriesData({ queryKey: getGetSupporterPhotoQueryKey() }, null);
}

export function updateSupporterPhotoCache(queryClient: QueryClient, photo: unknown) {
  queryClient.setQueriesData({ queryKey: getGetSupporterPhotoQueryKey() }, photo);
}