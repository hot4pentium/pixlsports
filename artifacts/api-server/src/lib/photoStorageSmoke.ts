import { randomUUID } from "node:crypto";
import type { File } from "@google-cloud/storage";
import sharp from "sharp";
import { objectStorageClient } from "./objectStorage";
import { privatePhotoStorageLocation } from "./photoStorageConfig";
import { canAccessObject, getObjectAclPolicy, ObjectPermission, setObjectAclPolicy } from "./objectAcl";

type SmokeStage = "configuration" | "write" | "acl" | "readback" | "anonymous" | "cleanup";
export type PhotoStorageSmokeResult =
  | { status: "passed" }
  | { status: "failed"; stage: SmokeStage };

// File is chosen before writing so even a partial write or failed ACL update
// is cleaned up. All returned diagnostics are allowlisted, never raw errors.
export async function verifyPrivatePhotoStorage(
  file: File, image: Buffer, anonymousRead: () => Promise<number>,
): Promise<PhotoStorageSmokeResult> {
  const owner = `photo-storage-smoke-${randomUUID()}`;
  let stage: SmokeStage = "write";
  let result: PhotoStorageSmokeResult = { status: "passed" };
  try {
    await file.save(image, { resumable: false, metadata: { contentType: "image/webp", cacheControl: "no-store" } });
    stage = "acl";
    await setObjectAclPolicy(file, { owner, visibility: "private" });
    const policy = await getObjectAclPolicy(file);
    if (policy?.visibility !== "private" || policy.owner !== owner
      || !(await canAccessObject({ objectFile: file, userId: owner, requestedPermission: ObjectPermission.READ }))
      || await canAccessObject({ objectFile: file, requestedPermission: ObjectPermission.READ })
      || await canAccessObject({ objectFile: file, userId: `${owner}-other`, requestedPermission: ObjectPermission.READ })) {
      throw new Error("Private ACL verification failed.");
    }
    stage = "readback";
    const [bytes] = await file.download();
    if (!image.equals(bytes)) throw new Error("Photo readback did not match.");
    stage = "anonymous";
    // Also detect bucket-level public access, which custom application ACLs
    // alone cannot prevent.
    if (![401, 403, 404].includes(await anonymousRead())) throw new Error("Object privacy could not be verified.");
  } catch {
    result = { status: "failed", stage };
  } finally {
    let cleaned = false;
    for (let attempt = 0; attempt < 3 && !cleaned; attempt++) {
      try {
        await file.delete({ ignoreNotFound: true });
        const [exists] = await file.exists();
        cleaned = !exists;
      } catch { /* Retry only this synthetic object; never hide a cleanup failure. */ }
    }
    if (!cleaned) result = { status: "failed", stage: "cleanup" };
  }
  return result;
}

export async function runPhotoStorageSmoke(): Promise<PhotoStorageSmokeResult> {
  let location: ReturnType<typeof privatePhotoStorageLocation>;
  try { location = privatePhotoStorageLocation(); } catch {
    return { status: "failed", stage: "configuration" };
  }
  const name = `${location.prefix}photo-storage-smoke/${randomUUID()}.webp`;
  const file = objectStorageClient.bucket(location.bucketName).file(name);
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#1976d2" } }).webp().toBuffer();
  return verifyPrivatePhotoStorage(file, image, async () => {
    const url = `https://storage.googleapis.com/${encodeURIComponent(location.bucketName)}/${name.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(5_000) });
    return response.status;
  });
}
