import { pool, type PoolClient } from "@workspace/db";
import type { GetNativeAthletePhotoStateResponse, RemoveNativeAthletePhotoBody } from "@workspace/api-zod";
import { getAdminClerkClient } from "./adminAccess";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";
import { ObjectStorageService } from "./objectStorage";
import { athletePhotoRevision } from "./athletePhotoRevision";
import { sanitizeAthleteInvitePhoto, InvalidAthleteInvitePhotoError } from "./athleteInvitePhoto";
import { nativePhotoStep } from "./nativeAthletePhotoDiagnostics";

type Profile = { athleteName: string; teamName: string };
type Card = {
  id: string; athlete_name: string; team_name: string;
  photo_object_path: string | null; cutout_object_path: string | null;
};
export type NativeAthletePhotoState = typeof GetNativeAthletePhotoStateResponse._output;
export type NativeAthletePhotoExpectation = typeof RemoveNativeAthletePhotoBody._output;
type Storage = {
  save: (contents: Buffer, owner: string) => Promise<string>;
  read: (path: string) => Promise<Buffer>;
  remove: (path: string) => Promise<void>;
};
const objectStorage = new ObjectStorageService();
const storage: Storage = {
  save: (contents, owner) => objectStorage.savePrivateObjectEntity(contents, "image/webp", owner),
  read: async (path) => {
    const [contents] = await (await objectStorage.getObjectEntityFile(path)).download();
    return contents;
  },
  remove: (path) => objectStorage.deleteObjectEntity(path),
};
const normalize = (value: string) => value.trim().toLocaleLowerCase("en-US");
const photoPath = (card: Card) => card.photo_object_path ?? card.cutout_object_path;
const snapshot = (card: Card): NativeAthletePhotoState => ({
  cardId: card.id, athleteName: card.athlete_name,
  hasPhoto: Boolean(photoPath(card)), revision: athletePhotoRevision(photoPath(card)) ?? "none",
});

export function createNativeAthletePhotoService(dependencies: {
  loadProfile?: (owner: string) => Promise<Profile>;
  storage?: Storage;
} = {}) {
  const media = dependencies.storage ?? storage;
  const loadProfile = dependencies.loadProfile ?? (async (owner: string) => {
    const user = await getAdminClerkClient().users.getUser(owner);
    return {
      athleteName: typeof user.unsafeMetadata.athleteName === "string" ? user.unsafeMetadata.athleteName : "",
      teamName: typeof user.unsafeMetadata.teamName === "string" ? user.unsafeMetadata.teamName : "",
    };
  });

  async function withCard<T>(
    identity: NativeIdentity,
    operation: (tx: PoolClient, card: Card, owner: string) => Promise<T>,
  ): Promise<T> {
    const tx = await nativePhotoStep("database_check", () => pool.connect());
    try {
      await nativePhotoStep("database_check", () => tx.query("BEGIN"));
      const { card, owner } = await nativePhotoStep("ownership", async () => {
        // Serialize against unlink, profile updates, and other native photo edits.
        const { rows: links } = await nativePhotoStep("database_check", () => tx.query<{ owner_clerk_user_id: string }>(
          `SELECT owner_clerk_user_id FROM native_account_links
           WHERE native_issuer=$1 AND native_subject=$2 FOR UPDATE`,
          [identity.issuer, identity.subject],
        ));
        const owner = links[0]?.owner_clerk_user_id;
        if (!owner) throw new NativeLinkError(404, "The linked PIXL account is unavailable.");
        await assertLinkableWebAccount(owner, tx);
        const profile = await loadProfile(owner);
        if (!profile.athleteName.trim()) {
          throw new NativeLinkError(409, "Save your athlete details before adding a photo.");
        }
        const { rows } = await nativePhotoStep("database_check", () => tx.query<Card>(
          `SELECT id, athlete_name, team_name, photo_object_path, cutout_object_path
           FROM athlete_invites WHERE owner_clerk_user_id=$1 ORDER BY created_at DESC FOR UPDATE`,
          [owner],
        ));
        const matches = rows.filter((card) =>
          normalize(card.athlete_name) === normalize(profile.athleteName)
          && (!profile.teamName.trim() || normalize(card.team_name) === normalize(profile.teamName)),
        );
        if (!profile.teamName.trim() && new Set(matches.map((card) => normalize(card.team_name))).size > 1) {
          throw new NativeLinkError(409, "Save a team name to identify the correct HYPE Card.");
        }
        const card = matches[0];
        if (!card) throw new NativeLinkError(
          rows.length ? 409 : 404,
          rows.length
            ? "Your saved HYPE Card doesn’t match this athlete. Review its identity in HYPE Card before changing the photo."
            : "This athlete doesn’t have a HYPE Card yet. Set up the HYPE Card before adding its photo.",
        );
        return { card, owner };
      });
      const result = await operation(tx, card, owner);
      await nativePhotoStep("database_persistence", () => tx.query("COMMIT"));
      return result;
    } catch (error) {
      // A rollback failure must not replace the useful original failure stage.
      await tx.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }

  function checkExpected(card: Card, expected: NativeAthletePhotoExpectation) {
    return nativePhotoStep("revision", async () => {
      if (card.id !== expected.cardId || snapshot(card).revision !== expected.revision) {
        throw new NativeLinkError(409, "The athlete or photo changed. Refresh the photo before trying again.");
      }
    });
  }

  async function cleanup(paths: (string | null)[]) {
    // The committed card is authoritative; failed cleanup must not report a
    // successful save as a failure or trigger a second destructive operation.
    await Promise.all([...new Set(paths.filter((path): path is string => Boolean(path)))]
      .map(async (path) => { try { await media.remove(path); } catch { /* Best-effort unreferenced media cleanup. */ } }));
  }

  return {
    state: (identity: NativeIdentity) => withCard(identity, async (_tx, card) => snapshot(card)),
    image: (identity: NativeIdentity, expected: NativeAthletePhotoExpectation) =>
      withCard(identity, async (_tx, card) => {
        await checkExpected(card, expected);
        return photoPath(card) ? nativePhotoStep("storage_read", () => media.read(photoPath(card)!)) : null;
      }),
    async save(identity: NativeIdentity, expected: NativeAthletePhotoExpectation, input: Buffer, contentType: string) {
      let newPath: string | null = null;
      let oldPaths: (string | null)[] = [];
      let result: NativeAthletePhotoState;
      try {
        result = await withCard(identity, async (tx, card, owner) => {
          await checkExpected(card, expected);
          const sanitized = await nativePhotoStep("validation", async () => {
            try { return await sanitizeAthleteInvitePhoto(input, contentType); } catch (error) {
              if (error instanceof InvalidAthleteInvitePhotoError) throw new NativeLinkError(400, error.message);
              throw error;
            }
          });
          newPath = await nativePhotoStep("storage_write", () => media.save(sanitized.contents, owner));
          await nativePhotoStep("database_persistence", () => tx.query(
            `UPDATE athlete_invites SET photo_object_path=$1, cutout_object_path=NULL, updated_at=NOW()
             WHERE id=$2 AND owner_clerk_user_id=$3`,
            [newPath, card.id, owner],
          ));
          oldPaths = [card.photo_object_path, card.cutout_object_path];
          return snapshot({ ...card, photo_object_path: newPath, cutout_object_path: null });
        });
      } catch (error) {
        if (newPath) await cleanup([newPath]);
        throw error;
      }
      await cleanup(oldPaths);
      return result;
    },
    async remove(identity: NativeIdentity, expected: NativeAthletePhotoExpectation) {
      let oldPaths: (string | null)[] = [];
      const result = await withCard(identity, async (tx, card, owner) => {
        await checkExpected(card, expected);
        await nativePhotoStep("database_persistence", () => tx.query(
          `UPDATE athlete_invites SET photo_object_path=NULL, cutout_object_path=NULL, updated_at=NOW()
           WHERE id=$1 AND owner_clerk_user_id=$2`, [card.id, owner],
        ));
        oldPaths = [card.photo_object_path, card.cutout_object_path];
        return snapshot({ ...card, photo_object_path: null, cutout_object_path: null });
      });
      await cleanup(oldPaths);
      return result;
    },
  };
}

export const nativeAthletePhoto = createNativeAthletePhotoService();
