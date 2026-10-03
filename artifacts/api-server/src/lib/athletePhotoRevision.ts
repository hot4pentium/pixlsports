import { createHash } from "node:crypto";

// An opaque identity for the original, unchanged by unrelated appearance edits.
export function athletePhotoRevision(objectPath: string | null) {
  return objectPath ? createHash("sha256").update(objectPath).digest("hex") : null;
}