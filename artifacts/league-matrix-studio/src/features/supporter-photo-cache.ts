import type { QueryClient } from '@tanstack/react-query';
import { getGetSupporterPhotoQueryKey } from '@workspace/api-client-react';

export function clearSupporterPhotoCache(queryClient: QueryClient) {
  queryClient.setQueryData(getGetSupporterPhotoQueryKey(), null);
}