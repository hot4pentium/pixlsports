import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { pool } from "@workspace/db";
import { createNativeAthletePhotoService } from "./nativeAthletePhoto";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";
import { nativePhotoFailureResponse, type NativePhotoStage } from "./nativeAthletePhotoDiagnostics";

const owners: string[] = [];
const subjects: string[] = [];
const jpeg = () => sharp({ create: { width: 80, height: 120, channels: 3, background: "#4488cc" } })
  .jpeg().withMetadata().toBuffer();
const rejectsStatus = (status: number) => (error: unknown) =>
  error instanceof NativeLinkError && error.status === status;
const rejectsStage = (stage: NativePhotoStage, status: number, operation: "save" | "image" | "remove" | "state" = "save") =>
  (error: unknown) => {
    const failure = nativePhotoFailureResponse(operation, error);
    assert.equal(failure.diagnostic.stage, stage);
    assert.equal(failure.status, status);
    return true;
  };
const privateDetails = "Bearer fixture-token /private/bucket/athlete.webp https://storage.invalid/photo?signature=fixture-secret athlete=PrivateName IMAGE_BYTES";
const unsafeError = () => Object.assign(new Error(privateDetails), {
  request: { headers: { authorization: privateDetails }, body: Buffer.from(privateDetails) },
  metadata: { athleteName: privateDetails }, code: privateDetails, cause: { credentials: privateDetails },
});

async function fixture() {
  const owner = `user_nativePhoto${randomUUID().replaceAll("-", "")}`;
  const identity: NativeIdentity = {
    issuer: "https://native-photo-fixture.clerk.accounts.dev",
    subject: `user_photo${randomUUID().replaceAll("-", "")}`,
  };
  owners.push(owner);
  subjects.push(identity.subject);
  await pool.query(`INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free','active')`, [owner]);
  await pool.query(`INSERT INTO native_account_links
    (native_issuer,native_subject,owner_clerk_user_id,account_label) VALUES ($1,$2,$3,'Photo test')`,
  [identity.issuer, identity.subject, owner]);
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone,
     show_hype_card,paused,show_stats,show_events)
    VALUES ($1,$2,'Jordan','Tigers','Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York',
    false,true,false,true) RETURNING id`, [owner, randomBytes(18).toString("base64url")]);
  const objects = new Map<string, Buffer>();
  const removed: string[] = [];
  let saveFails = false;
  let readFails = false;
  let cleanupFails = false;
  let saves = 0;
  const profile = { athleteName: "Jordan", teamName: "Tigers" };
  const newService = () => createNativeAthletePhotoService({
    loadProfile: async (linkedOwner) => {
      assert.equal(linkedOwner, owner);
      return profile;
    },
    storage: {
      save: async (contents, linkedOwner) => {
        assert.equal(linkedOwner, owner);
        if (saveFails) throw unsafeError();
        saves++;
        const path = `/objects/photo-test/${randomUUID()}.webp`;
        objects.set(path, contents);
        return path;
      },
      read: async (path) => {
        if (readFails) throw unsafeError();
        const bytes = objects.get(path);
        assert.ok(bytes, "Only stored photo objects may be read");
        return bytes;
      },
      remove: async (path) => {
        if (cleanupFails) throw unsafeError();
        removed.push(path); objects.delete(path);
      },
    },
  });
  return {
    owner, identity, id: rows[0]!.id, service: newService(), newService, objects, removed, profile,
    get saves() { return saves; },
    failSave() { saveFails = true; },
    restoreSave() { saveFails = false; },
    failRead() { readFails = true; },
    restoreRead() { readFails = false; },
    failCleanup() { cleanupFails = true; },
  };
}

after(async () => {
  await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [subjects]);
  await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

test("native photo upload sanitizes media and preserves private, paused, and section settings", async () => {
  const f = await fixture();
  const before = await f.service.state(f.identity);
  assert.equal(before.revision, "none");
  const result = await f.service.save(f.identity, before, await jpeg(), "image/jpeg");
  assert.equal(result.hasPhoto, true);
  assert.notEqual(result.revision, "none");
  assert.equal("objectPath" in result, false);
  const image = await f.service.image(f.identity, result);
  assert.ok(image);
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  const { rows } = await pool.query(`SELECT show_hype_card, paused, show_stats, show_events,
    photo_object_path, cutout_object_path FROM athlete_invites WHERE id=$1`, [f.id]);
  assert.deepEqual(
    [rows[0].show_hype_card, rows[0].paused, rows[0].show_stats, rows[0].show_events],
    [false, true, false, true],
  );
  assert.equal(rows[0].cutout_object_path, null);
  assert.ok(f.objects.has(rows[0].photo_object_path));
});

test("replacement removes the old photo and legacy cutout only after saving the new image", async () => {
  const f = await fixture();
  const old = "/objects/old-photo";
  const cutout = "/objects/old-cutout";
  f.objects.set(old, Buffer.from("old"));
  f.objects.set(cutout, Buffer.from("cutout"));
  await pool.query("UPDATE athlete_invites SET photo_object_path=$1,cutout_object_path=$2 WHERE id=$3",
    [old, cutout, f.id]);
  const before = await f.service.state(f.identity);
  const saved = await f.service.save(f.identity, before, await jpeg(), "image/jpeg");
  assert.notEqual(saved.revision, before.revision);
  assert.deepEqual(new Set(f.removed), new Set([old, cutout]));
  assert.equal(f.objects.size, 1);
  await assert.rejects(f.service.image(f.identity, before), rejectsStatus(409));
});

test("invalid, oversized, and mismatched-content images cannot alter the current photo", async () => {
  const f = await fixture();
  const before = await f.service.state(f.identity);
  for (const [bytes, type] of [
    [Buffer.from("not an image"), "image/jpeg"],
    [Buffer.alloc(5 * 1024 * 1024 + 1), "image/jpeg"],
    [await jpeg(), "image/png"],
  ] as const) {
    await assert.rejects(f.service.save(f.identity, before, bytes, type), rejectsStage("validation", 400));
  }
  assert.equal(f.saves, 0);
  assert.deepEqual(await f.service.state(f.identity), before);
});

test("a stale replacement, stale removal, and another owner's card ID are rejected", async () => {
  const f = await fixture();
  const other = await fixture();
  const before = await f.service.state(f.identity);
  const current = await f.service.save(f.identity, before, await jpeg(), "image/jpeg");
  await assert.rejects(f.service.save(f.identity, before, await jpeg(), "image/jpeg"), rejectsStage("revision", 409));
  await assert.rejects(f.service.remove(f.identity, before), rejectsStage("revision", 409, "remove"));
  await assert.rejects(f.service.remove(f.identity, { ...current, cardId: other.id }), rejectsStatus(409));
  assert.equal(f.saves, 1);
  assert.equal(f.removed.length, 0);
});

test("removal persists and does not change public sharing settings", async () => {
  const f = await fixture();
  await pool.query("UPDATE athlete_invites SET show_hype_card=true,paused=false WHERE id=$1", [f.id]);
  const current = await f.service.save(f.identity, await f.service.state(f.identity), await jpeg(), "image/jpeg");
  const removed = await f.service.remove(f.identity, current);
  assert.equal(removed.hasPhoto, false);
  assert.equal(removed.revision, "none");
  assert.deepEqual(await f.service.state(f.identity), removed);
  assert.equal(await f.service.image(f.identity, removed), null);
  assert.equal(f.objects.size, 0);
  const { rows } = await pool.query("SELECT show_hype_card,paused FROM athlete_invites WHERE id=$1", [f.id]);
  assert.deepEqual(rows[0], { show_hype_card: true, paused: false });
});

test("unlinked, cancelled, and mismatched athletes cannot read or write the photo", async () => {
  const f = await fixture();
  const current = await f.service.state(f.identity);
  await assert.rejects(f.service.state({ ...f.identity, subject: "user_unlinked_photo" }), rejectsStage("ownership", 404, "state"));
  f.profile.athleteName = "Someone else";
  await assert.rejects(f.service.state(f.identity), rejectsStatus(409));
  await assert.rejects(f.service.remove(f.identity, current), rejectsStatus(409));
  f.profile.athleteName = "Jordan";
  await pool.query("UPDATE account_access SET lifecycle_status='cancelled' WHERE owner_clerk_user_id=$1", [f.owner]);
  await assert.rejects(f.service.state(f.identity), (error) => error instanceof NativeLinkError);
  assert.equal(f.saves, 0);
});

test("storage failure leaves the saved card and photo unchanged", async () => {
  const f = await fixture();
  const current = await f.service.save(f.identity, await f.service.state(f.identity), await jpeg(), "image/jpeg");
  const priorImage = await f.service.image(f.identity, current);
  f.failSave();
  await assert.rejects(f.service.save(f.identity, current, await jpeg(), "image/jpeg"), rejectsStage("storage_write", 503));
  assert.deepEqual(await f.service.state(f.identity), current);
  assert.equal(f.objects.size, 1);
  assert.equal(f.removed.length, 0);
  assert.deepEqual(await f.service.image(f.identity, current), priorImage);

  // Recovery uses the same revision; a failed upload must not consume it.
  f.restoreSave();
  const replacement = await sharp({
    create: { width: 100, height: 160, channels: 3, background: "#cc4422" },
  }).jpeg().toBuffer();
  const saved = await f.service.save(f.identity, current, replacement, "image/jpeg");
  assert.notEqual(saved.revision, current.revision);
  assert.equal(f.objects.size, 1);
  assert.equal(f.removed.length, 1);
  const freshService = f.newService();
  assert.deepEqual(await freshService.state(f.identity), saved);
  const savedImage = await freshService.image(f.identity, saved);
  assert.ok(savedImage);
  assert.notDeepEqual(savedImage, priorImage);
  assert.equal((await sharp(savedImage).metadata()).height, 160);
  const { rows } = await pool.query(
    "SELECT show_hype_card,paused,show_stats,show_events,cutout_object_path FROM athlete_invites WHERE id=$1",
    [f.id],
  );
  assert.deepEqual(rows[0], {
    show_hype_card: false, paused: true, show_stats: false, show_events: true, cutout_object_path: null,
  });
});

test("concurrent uploads with the same revision allow only one replacement", async () => {
  const f = await fixture();
  const current = await f.service.state(f.identity);
  const bytes = await jpeg();
  const results = await Promise.allSettled([
    f.service.save(f.identity, current, bytes, "image/jpeg"),
    f.service.save(f.identity, current, bytes, "image/jpeg"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejectsStatus(409)(rejected.reason));
  assert.equal(f.saves, 1);
});

test("an account without a HYPE Card cannot modify another account's matching card", async () => {
  const f = await fixture();
  const other = await fixture();
  const otherState = await other.service.state(other.identity);
  await pool.query("DELETE FROM athlete_invites WHERE id=$1", [f.id]);
  await assert.rejects(f.service.state(f.identity), rejectsStatus(404));
  await assert.rejects(f.service.save(f.identity, otherState, await jpeg(), "image/jpeg"), rejectsStatus(404));
  assert.equal(f.saves, 0);
  assert.equal(f.removed.length, 0);
});

test("unlinking after loading the photo prevents reads, replacement, and removal", async () => {
  const f = await fixture();
  const current = await f.service.state(f.identity);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=$1", [f.identity.subject]);
  await assert.rejects(f.service.image(f.identity, current), rejectsStatus(404));
  await assert.rejects(f.service.save(f.identity, current, await jpeg(), "image/jpeg"), rejectsStatus(404));
  await assert.rejects(f.service.remove(f.identity, current), rejectsStatus(404));
  assert.equal(f.saves, 0);
});

test("storage reads fail safely and can retry with the same photo revision", async () => {
  const f = await fixture();
  const current = await f.service.save(f.identity, await f.service.state(f.identity), await jpeg(), "image/jpeg");
  f.failRead();
  await assert.rejects(f.service.image(f.identity, current), rejectsStage("storage_read", 503, "image"));
  assert.deepEqual(await f.service.state(f.identity), current);
  f.restoreRead();
  assert.ok(await f.service.image(f.identity, current));
});

test("failed unreferenced-media cleanup does not turn a committed save or removal into a retry", async () => {
  const f = await fixture();
  const current = await f.service.save(f.identity, await f.service.state(f.identity), await jpeg(), "image/jpeg");
  f.failCleanup();
  const replacement = await f.service.save(f.identity, current, await jpeg(), "image/jpeg");
  assert.notEqual(replacement.revision, current.revision);
  const removed = await f.service.remove(f.identity, replacement);
  assert.equal(removed.hasPhoto, false);
  assert.deepEqual(await f.service.state(f.identity), removed);
});

test("database connection, update, and commit errors retain their stage and roll back the photo", async (t) => {
  const f = await fixture();
  const current = await f.service.save(f.identity, await f.service.state(f.identity), await jpeg(), "image/jpeg");
  const connect = pool.connect.bind(pool);
  const connectMock = t.mock.method(pool, "connect", async () => { throw unsafeError(); });
  await assert.rejects(f.service.state(f.identity), rejectsStage("database_check", 503, "state"));
  connectMock.mock.restore();
  for (const statement of ["UPDATE athlete_invites", "COMMIT"]) {
    const tx = await connect();
    const query = tx.query.bind(tx);
    const queryMock = t.mock.method(tx, "query", async (sql: string, values?: unknown[]) => {
      if (sql.trim().startsWith(statement)) throw unsafeError();
      return query(sql, values);
    });
    const mock = t.mock.method(pool, "connect", async () => tx);
    try {
      await assert.rejects(f.service.save(f.identity, current, await jpeg(), "image/jpeg"),
        rejectsStage("database_persistence", 503));
    } finally {
      mock.mock.restore();
      queryMock.mock.restore();
    }
    assert.deepEqual(await f.service.state(f.identity), current);
    assert.equal(f.objects.size, 1, "The uncommitted new image is cleaned up, not the saved image");
  }
});
