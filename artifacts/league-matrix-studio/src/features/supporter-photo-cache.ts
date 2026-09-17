import type { QueryClient } from '@tanstack/react-query';
import { getGetSupporterPhotoQueryKey } from '@workspace/api-client-react';

export function clearSupporterPhotoCache(queryClient: QueryClient) {
  queryClient.setQueryData(getGetSupporterPhotoQueryKey(), null);
}

export function updateSupporterPhotoCache(queryClient: QueryClient, photo: unknown) {
  queryClient.setQueryData(getGetSupporterPhotoQueryKey(), photo);
}