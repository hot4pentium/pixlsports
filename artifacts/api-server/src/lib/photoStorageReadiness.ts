import { objectStorageClient } from "./objectStorage";
import { privatePhotoStorageLocation } from "./photoStorageConfig";

export type PhotoStorageReadiness =
  | { status: "ready" }
  | { status: "unavailable"; reason: "configuration" | "access" };

export const photoStorageUnavailableMessage =
  "Photo uploads are temporarily unavailable. Your schedule and tracking are still available. Refresh the photo section to try again.";

export function createPhotoStorageReadiness(dependencies: {
  configuration?: typeof privatePhotoStorageLocation;
  probe?: (location: ReturnType<typeof privatePhotoStorageLocation>) => Promise<unknown>;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
} = {}) {
  const configuration = dependencies.configuration ?? privatePhotoStorageLocation;
  const probe = dependencies.probe ?? (async ({ bucketName, prefix }) => {
    // Read-only and bounded: no fixtures or user images are downloaded.
    await objectStorageClient.bucket(bucketName).getFiles({
      prefix, maxResults: 1, autoPaginate: false,
    });
  });
  const now = dependencies.now ?? Date.now;
  let cached: { location: string; until: number; result: PhotoStorageReadiness } | undefined;
  let pending: { location: string; promise: Promise<PhotoStorageReadiness> } | undefined;
  return async (): Promise<PhotoStorageReadiness> => {
    let location: ReturnType<typeof configuration>;
    try { location = configuration(); } catch {
      return { status: "unavailable", reason: "configuration" };
    }
    if (cached?.location === location.dir && cached.until > now()) return cached.result;
    if (pending?.location === location.dir) return pending.promise;
    const promise = (async (): Promise<PhotoStorageReadiness> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: PhotoStorageReadiness;
      try {
        await Promise.race([
          Promise.resolve().then(() => probe(location)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Storage check timed out.")), dependencies.timeoutMs ?? 5_000);
          }),
        ]);
        result = { status: "ready" };
      } catch {
        result = { status: "unavailable", reason: "access" };
      } finally {
        clearTimeout(timer);
      }
      cached = { location: location.dir, until: now() + (dependencies.ttlMs ?? 30_000), result };
      return result;
    })();
    pending = { location: location.dir, promise };
    try { return await promise; } finally {
      if (pending?.promise === promise) pending = undefined;
    }
  };
}

export const checkPhotoStorageReadiness = createPhotoStorageReadiness();
