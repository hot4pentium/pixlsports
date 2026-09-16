import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { getGetSupporterPhotoQueryKey } from '@workspace/api-client-react';
import { clearSupporterPhotoCache } from './supporter-photo-cache';

test('successful photo removal notifies the active view with no photo immediately', () => {
  const queryClient = new QueryClient();
  const queryKey = getGetSupporterPhotoQueryKey();
  queryClient.setQueryData(queryKey, {
    url: '/api/supporter-photo/image',
    contentType: 'image/jpeg',
    size: 123,
    updatedAt: new Date().toISOString(),
  });

  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => queryClient.getQueryData(queryKey),
    enabled: false,
  });
  const observed: unknown[] = [];
  const unsubscribe = observer.subscribe((result) => observed.push(result.data));

  clearSupporterPhotoCache(queryClient);

  assert.equal(queryClient.getQueryData(queryKey), null);
  assert.equal(observer.getCurrentResult().data, null);
  assert.equal(observed.at(-1), null);
  unsubscribe();
});