import type { QueryClient } from '@tanstack/react-query';
import {
  getGetSupporterPhotoQueryKey,
  useGetSupporterPhoto,
  type SupporterPhoto,
} from '@workspace/api-client-react';
import { useEffect, useMemo, useState } from 'react';

export const supporterPhotoStoragePrefix = 'pixlsports-supporter-photo';
export const supporterPhotoBrowserCacheName = 'pixl-sports-supporter-photo-v1';

function getSupporterPhotoStorageKey(userId: string) {
  return `${supporterPhotoStoragePrefix}:${encodeURIComponent(userId)}`;
}

function getSupporterPhotoCacheRequest(userId: string, updatedAt: string) {
  return new Request(
    `https://pixl-sports-photo-cache.invalid/${encodeURIComponent(userId)}/${encodeURIComponent(updatedAt)}`,
  );
}

export function readCachedSupporterPhoto(
  storage: Pick<Storage, 'getItem'>,
  userId: string | null | undefined,
): SupporterPhoto | null {
  if (!userId) return null;
  try {
    const raw = storage.getItem(getSupporterPhotoStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupporterPhoto>;
    if (
      typeof parsed.url !== 'string'
      || typeof parsed.contentType !== 'string'
      || typeof parsed.size !== 'number'
      || typeof parsed.cropX !== 'number'
      || typeof parsed.cropY !== 'number'
      || typeof parsed.cropZoom !== 'number'
      || typeof parsed.updatedAt !== 'string'
    ) return null;
    return parsed as SupporterPhoto;
  } catch {
    return null;
  }
}

export function writeCachedSupporterPhoto(
  storage: Pick<Storage, 'setItem'>,
  userId: string | null | undefined,
  photo: SupporterPhoto,
): void {
  if (!userId) return;
  try {
    storage.setItem(getSupporterPhotoStorageKey(userId), JSON.stringify(photo));
  } catch {
    // The remote query remains authoritative when browser storage is unavailable.
  }
}

export function clearCachedSupporterPhoto(
  storage: Pick<Storage, 'removeItem'>,
  userId: string | null | undefined,
): void {
  if (!userId) return;
  try {
    storage.removeItem(getSupporterPhotoStorageKey(userId));
  } catch {
    // A failed cleanup must not block sign-out or photo removal.
  }
}

async function readCachedSupporterPhotoImage(userId: string, updatedAt: string): Promise<Blob | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cache = await window.caches.open(supporterPhotoBrowserCacheName);
    const response = await cache.match(getSupporterPhotoCacheRequest(userId, updatedAt));
    return response?.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

async function cacheSupporterPhotoImage(userId: string, photo: SupporterPhoto): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const response = await fetch(`${photo.url}?v=${encodeURIComponent(photo.updatedAt)}`, {
      credentials: 'include',
    });
    if (!response.ok) return;
    const cache = await window.caches.open(supporterPhotoBrowserCacheName);
    await cache.put(
      getSupporterPhotoCacheRequest(userId, photo.updatedAt),
      new Response(await response.blob(), {
        headers: { 'Content-Type': photo.contentType },
      }),
    );
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter((request) => (
          request.url.includes(`/${encodeURIComponent(userId)}/`)
          && !request.url.endsWith(`/${encodeURIComponent(photo.updatedAt)}`)
        ))
        .map((request) => cache.delete(request)),
    );
  } catch {
    // The normal protected image URL remains the fallback.
  }
}

async function clearCachedSupporterPhotoImage(userId: string): Promise<void> {
  if (!userId || typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await window.caches.open(supporterPhotoBrowserCacheName);
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter((request) => request.url.includes(`/${encodeURIComponent(userId)}/`))
        .map((request) => cache.delete(request)),
    );
  } catch {
    // A failed cleanup must not block sign-out or photo removal.
  }
}

export function useCachedSupporterPhoto(userId: string | null | undefined, enabled: boolean) {
  const cachedPhoto = useMemo(
    () => (
      typeof window === 'undefined'
        ? null
        : readCachedSupporterPhoto(window.localStorage, userId)
    ),
    [userId],
  );
  const [cachedImageUrl, setCachedImageUrl] = useState<string>();
  const query = useGetSupporterPhoto({
    query: {
      enabled: Boolean(enabled && userId),
      queryKey: [...getGetSupporterPhotoQueryKey(), userId ?? 'signed-out'],
      initialData: cachedPhoto ?? undefined,
      initialDataUpdatedAt: cachedPhoto ? Date.parse(cachedPhoto.updatedAt) : undefined,
      refetchOnMount: 'always',
      retry: false,
      staleTime: 0,
    },
  });
  const photoNotFound = query.isError
    && (query.error as { status?: unknown } | null)?.status === 404;
  const photo = photoNotFound
    ? null
    : query.data === null
      ? null
      : (query.data ?? cachedPhoto);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setCachedImageUrl(undefined);
    if (!userId || !photo) return undefined;

    void readCachedSupporterPhotoImage(userId, photo.updatedAt).then((blob) => {
      if (disposed || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setCachedImageUrl(objectUrl);
    });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, userId]);

  useEffect(() => {
    if (!userId || !query.data) return;
    if (typeof window !== 'undefined') {
      writeCachedSupporterPhoto(window.localStorage, userId, query.data);
    }
    void cacheSupporterPhotoImage(userId, query.data);
  }, [query.data, userId]);

  useEffect(() => {
    if (!photoNotFound || !userId) return;
    if (typeof window !== 'undefined') clearCachedSupporterPhoto(window.localStorage, userId);
    void clearCachedSupporterPhotoImage(userId);
  }, [photoNotFound, userId]);

  return {
    ...query,
    data: photo,
    imageUrl: cachedImageUrl ?? (
      photo
        ? `${photo.url}?v=${encodeURIComponent(photo.updatedAt)}`
        : undefined
    ),
    clearLocalCache: () => {
      if (typeof window !== 'undefined') clearCachedSupporterPhoto(window.localStorage, userId);
      void clearCachedSupporterPhotoImage(userId ?? '');
    },
  };
}

export function clearSupporterPhotoCache(queryClient: QueryClient) {
  queryClient.setQueriesData({ queryKey: getGetSupporterPhotoQueryKey() }, null);
}

export function updateSupporterPhotoCache(queryClient: QueryClient, photo: unknown) {
  queryClient.setQueriesData({ queryKey: getGetSupporterPhotoQueryKey() }, photo);
}