import assert from "node:assert/strict";
import test from "node:test";
import {
  generateSupportTicketReference,
  insertSupportTicketWithUniqueReference,
  MAX_SUPPORT_TICKET_REFERENCE_ATTEMPTS,
  SupportTicketReferenceUnavailableError,
} from "./supportTicketReference";

test("new support ticket references are short and use unambiguous uppercase characters", () => {
  const reference = generateSupportTicketReference((size) => {
    assert.equal(size, 5);
    return Buffer.alloc(size);
  });

  assert.equal(reference, "PS-22222222");
  assert.equal(reference.length, 11);
  assert.match(reference, /^PS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
});

test("reference insertion retries a unique collision and returns the successful record", async () => {
  const references = ["PS-22222222", "PS-33333333"];
  const attempted: string[] = [];
  const created = await insertSupportTicketWithUniqueReference(
    async (reference) => {
      attempted.push(reference);
      return reference === "PS-33333333" ? { reference } : null;
    },
    () => references[attempted.length],
  );

  assert.deepEqual(attempted, references);
  assert.deepEqual(created, { reference: "PS-33333333" });
});

test("reference insertion stops after the bounded collision retry limit", async () => {
  const attempted: string[] = [];

  await assert.rejects(
    insertSupportTicketWithUniqueReference(
      async (reference) => {
        attempted.push(reference);
        return null;
      },
      () => "PS-22222222",
    ),
    (error: unknown) => {
      assert.ok(error instanceof SupportTicketReferenceUnavailableError);
      assert.equal(error.attempts, MAX_SUPPORT_TICKET_REFERENCE_ATTEMPTS);
      return true;
    },
  );

  assert.equal(attempted.length, MAX_SUPPORT_TICKET_REFERENCE_ATTEMPTS);
});

test("reference insertion does not retry unrelated database failures", async () => {
  const failure = new Error("database unavailable");
  let calls = 0;

  await assert.rejects(
    insertSupportTicketWithUniqueReference(
      async () => {
        calls += 1;
        throw failure;
      },
      () => "PS-22222222",
    ),
    failure,
  );

  assert.equal(calls, 1);
});

test("reference insertion rejects an invalid retry limit", async () => {
  await assert.rejects(
    insertSupportTicketWithUniqueReference(async () => null, () => "PS-22222222", 0),
    RangeError,
  );
});
