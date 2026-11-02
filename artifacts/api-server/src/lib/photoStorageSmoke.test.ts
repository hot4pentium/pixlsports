import test from "node:test";
import assert from "node:assert/strict";
import type { File } from "@google-cloud/storage";
import { verifyPrivatePhotoStorage } from "./photoStorageSmoke";

function fixture(failure?: string) {
  let exists = false;
  let metadata = {};
  let deletes = 0;
  const image = Buffer.from("synthetic image");
  const file = {
    save: async () => { exists = true; if (failure === "write") throw new Error("private/path"); },
    exists: async () => [exists],
    setMetadata: async (value: object) => {
      if (failure === "acl") throw new Error("secret credential");
      metadata = value;
    },
    getMetadata: async () => [metadata],
    download: async () => {
      if (failure === "readback") throw new Error("private/path");
      return [failure === "mismatch" ? Buffer.from("wrong") : image];
    },
    delete: async () => {
      deletes++;
      if (failure === "cleanup" || (failure === "retry" && deletes < 3)) throw new Error("private/path");
      exists = false;
    },
  } as unknown as File;
  return { file, image, exists: () => exists, deletes: () => deletes };
}

test("smoke verifies private ACL, owner-only access and readback, then removes its object", async () => {
  const f = fixture();
  assert.deepEqual(await verifyPrivatePhotoStorage(f.file, f.image, async () => 403), { status: "passed" });
  assert.equal(f.exists(), false);
  assert.equal(f.deletes(), 1);
});

for (const [failure, stage] of [["write", "write"], ["acl", "acl"], ["readback", "readback"], ["mismatch", "readback"]] as const) {
  test(`smoke cleans up after ${failure} failure and never returns private details`, async () => {
    const f = fixture(failure);
    assert.deepEqual(await verifyPrivatePhotoStorage(f.file, f.image, async () => 403), { status: "failed", stage });
    assert.equal(f.exists(), false);
  });
}

test("smoke rejects anonymous public access and ambiguous access errors, always cleaning up", async () => {
  for (const status of [200, 302, 500]) {
    const f = fixture();
    assert.deepEqual(await verifyPrivatePhotoStorage(f.file, f.image, async () => status), { status: "failed", stage: "anonymous" });
    assert.equal(f.exists(), false);
  }
  const f = fixture();
  assert.deepEqual(await verifyPrivatePhotoStorage(f.file, f.image, async () => { throw new Error("secret URL"); }),
    { status: "failed", stage: "anonymous" });
  assert.equal(f.exists(), false);
});

test("smoke retries deletion and explicitly fails if cleanup cannot be confirmed", async () => {
  for (const failure of ["retry", "cleanup"]) {
    const f = fixture(failure);
    assert.deepEqual(await verifyPrivatePhotoStorage(f.file, f.image, async () => 403),
      failure === "retry" ? { status: "passed" } : { status: "failed", stage: "cleanup" });
    assert.equal(f.deletes(), 3);
  }
});
