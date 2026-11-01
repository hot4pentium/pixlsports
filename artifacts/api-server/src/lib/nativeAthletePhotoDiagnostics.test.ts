import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeLinkError } from "./nativeIdentity";
import {
  nativePhotoFailureResponse, nativePhotoStep, type NativePhotoStage,
} from "./nativeAthletePhotoDiagnostics";

const secrets = [
  "Bearer secret-fixture-token", "PRIVATE_IMAGE_BYTES", "Private Athlete Name",
  "https://storage.invalid/object?X-Goog-Signature=secret-signature",
  "/private/bucket/athlete.webp", "postgres://user:password@private.invalid/db",
];
const poison = () => Object.assign(new Error(secrets.join(" ")), {
  code: secrets[3], request: { headers: { authorization: secrets[0] }, data: Buffer.from(secrets[1]!) },
  metadata: { athleteName: secrets[2] }, cause: { url: secrets[5] },
  toJSON() { throw new Error("Do not serialize dependency errors"); },
});

for (const stage of [
  "validation", "ownership", "revision", "database_check", "database_persistence",
  "storage_write", "storage_read", "response",
] satisfies NativePhotoStage[]) {
  test(`${stage} diagnostics are useful, bounded, and never copy sensitive error fields`, async () => {
    await assert.rejects(nativePhotoStep(stage, async () => { throw poison(); }), (error: unknown) => {
      const failure = nativePhotoFailureResponse("save", error);
      assert.deepEqual(failure, {
        status: 503,
        body: { error: "PIXL Sports is temporarily unavailable. Please try again." },
        diagnostic: {
          event: "native_athlete_photo_failure", operation: "save",
          stage, category: "infrastructure", status: 503,
        },
      });
      const serialized = JSON.stringify(failure);
      for (const secret of secrets) assert.equal(serialized.includes(secret), false);
      assert.ok(serialized.length < 400);
      assert.equal(error instanceof Error && "cause" in error, false);
      return true;
    });
  });
}

test("only trusted validation and access errors preserve 400/409 and retry guidance", async () => {
  for (const [stage, status] of [["validation", 400], ["revision", 409], ["ownership", 409]] as const) {
    const guidance = "Refresh the photo before trying again.";
    await assert.rejects(nativePhotoStep(stage, async () => { throw new NativeLinkError(status, guidance); }),
      (error: unknown) => {
        const failure = nativePhotoFailureResponse("remove", error);
        assert.equal(failure.status, status);
        assert.deepEqual(failure.body, { error: guidance });
        assert.equal(failure.diagnostic.stage, stage);
        assert.equal(failure.diagnostic.category, "rejected");
        return true;
      });
  }
});

test("storage errors cannot masquerade as safe user errors; outer checks preserve inner stages", async () => {
  await assert.rejects(nativePhotoStep("ownership", () => nativePhotoStep("storage_write", async () => {
    throw new NativeLinkError(400, secrets.join(" "));
  })), (error: unknown) => {
    const failure = nativePhotoFailureResponse("save", error);
    assert.equal(failure.diagnostic.stage, "storage_write");
    assert.equal(failure.status, 503);
    for (const secret of secrets) assert.equal(JSON.stringify(failure).includes(secret), false);
    return true;
  });
});

test("unclassified dependency errors never reach the response or diagnostic record", () => {
  assert.equal(nativePhotoFailureResponse("state", poison()).diagnostic.stage, "response");
  for (const status of [400, 409, 429]) {
    assert.equal(nativePhotoFailureResponse("save", new NativeLinkError(status, "Safe guidance")).status, status);
  }
  const failure = nativePhotoFailureResponse("image", new NativeLinkError(503, secrets.join(" ")));
  for (const secret of secrets) assert.equal(JSON.stringify(failure).includes(secret), false);
});
