import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleForInitialAccountSetup } from "./accountProvisioning";

test("only recent identities without prior setup metadata may provision a first account", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  const freshIdentity = {
    createdAt: now - 60_000,
    publicMetadata: {},
    unsafeMetadata: {},
  };

  assert.equal(isEligibleForInitialAccountSetup(freshIdentity, now), true);
  assert.equal(isEligibleForInitialAccountSetup({
    ...freshIdentity,
    publicMetadata: { pixlSportsAccountProvisioned: true },
  }, now), false);
  assert.equal(isEligibleForInitialAccountSetup({
    ...freshIdentity,
    unsafeMetadata: { displayName: "Morgan" },
  }, now), false);
  assert.equal(isEligibleForInitialAccountSetup({
    ...freshIdentity,
    createdAt: now - 8 * 24 * 60 * 60 * 1000,
  }, now), false);
  assert.equal(isEligibleForInitialAccountSetup({
    ...freshIdentity,
    createdAt: now + 1_000,
  }, now), false);
});