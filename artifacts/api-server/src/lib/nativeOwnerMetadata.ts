import { pool, type PoolClient } from "@workspace/db";
import { getAdminClerkClient } from "./adminAccess";
import { NativeLinkError } from "./nativeIdentity";

export const isNativeProfileOwner = (owner: string) => /^pixl-ios:[a-f0-9]{64}$/.test(owner);

/** New iOS owners use database profiles; existing owners retain their metadata. */
export async function readNativeOwnerMetadata(owner: string, tx?: PoolClient) {
  if (!isNativeProfileOwner(owner)) return getAdminClerkClient().users.getUser(owner);
  const result = await (tx ?? pool).query<{ profile_metadata: Record<string, unknown> }>(
    "SELECT profile_metadata FROM native_accounts WHERE owner_id=$1", [owner],
  );
  if (!result.rows[0]) throw new NativeLinkError(409, "Your iPhone profile needs attention. Please try again.");
  return { unsafeMetadata: result.rows[0].profile_metadata };
}

export async function writeNativeOwnerMetadata(
  owner: string, metadata: Record<string, unknown>, tx?: PoolClient,
) {
  if (!isNativeProfileOwner(owner)) {
    await getAdminClerkClient().users.updateUser(owner, { unsafeMetadata: metadata });
    return;
  }
  const result = await (tx ?? pool).query(
    "UPDATE native_accounts SET profile_metadata=$2::jsonb,updated_at=NOW() WHERE owner_id=$1",
    [owner, JSON.stringify(metadata)],
  );
  if (!result.rowCount) throw new NativeLinkError(409, "Your iPhone profile needs attention. Please try again.");
}
