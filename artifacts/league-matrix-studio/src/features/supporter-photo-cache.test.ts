import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { getGetSupporterPhotoQueryKey } from '@workspace/api-client-react';
import { clearSupporterPhotoCache, updateSupporterPhotoCache } from './supporter-photo-cache';

test('successful photo removal notifies the active view with no photo immediately', () => {
  const queryClient = new QueryClient();
  const queryKey = getGetSupporterPhotoQueryKey();
  const accountScopedQueryKey = [...queryKey, 'user-1'];
  queryClient.setQueryData(queryKey, {
    url: '/api/supporter-photo/image',
    contentType: 'image/jpeg',
    size: 123,
    updatedAt: new Date().toISOString(),
  });
  queryClient.setQueryData(accountScopedQueryKey, {
    url: '/api/supporter-photo/image',
    contentType: 'image/jpeg',
    size: 456,
    updatedAt: new Date().toISOString(),
  });

  const observer = new QueryObserver(queryClient, {
    queryKey: accountScopedQueryKey,
    queryFn: async () => queryClient.getQueryData(queryKey),
    enabled: false,
  });
  const observed: unknown[] = [];
  const unsubscribe = observer.subscribe((result) => observed.push(result.data));

  clearSupporterPhotoCache(queryClient);

  assert.equal(queryClient.getQueryData(queryKey), null);
  assert.equal(queryClient.getQueryData(accountScopedQueryKey), null);
  assert.equal(observer.getCurrentResult().data, null);
  assert.equal(observed.at(-1), null);
  unsubscribe();
});

test('successful photo save immediately replaces stale crop data in the active view', () => {
  const queryClient = new QueryClient();
  const queryKey = getGetSupporterPhotoQueryKey();
  const accountScopedQueryKey = [...queryKey, 'user-1'];
  queryClient.setQueryData(queryKey, {
    url: '/api/supporter-photo/image',
    cropX: 50,
    cropY: 50,
    cropZoom: 100,
    updatedAt: '2026-09-17T20:00:00.000Z',
  });
  queryClient.setQueryData(accountScopedQueryKey, {
    url: '/api/supporter-photo/image',
    cropX: 12,
    cropY: 88,
    cropZoom: 110,
    updatedAt: '2026-09-17T19:00:00.000Z',
  });
  const savedPhoto = {
    url: '/api/supporter-photo/image',
    cropX: 72,
    cropY: 34,
    cropZoom: 185,
    updatedAt: '2026-09-17T21:00:00.000Z',
  };

  updateSupporterPhotoCache(queryClient, savedPhoto);

  assert.deepEqual(queryClient.getQueryData(queryKey), savedPhoto);
  assert.deepEqual(queryClient.getQueryData(accountScopedQueryKey), savedPhoto);
});