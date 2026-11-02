import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import {
  DeletionCompletionEmailError,
  deletionCompletionMessage,
  prepareNativeDeletionCompletionEmail,
  runNativeDeletionCompletionEmails,
  sendNativeDeletionCompletionEmail,
} from "./nativeAccountDeletionEmail";
import { runNativeAccountDeletions } from "../jobs/nativeAccountDeletions";

const issuer = `https://receipt-${randomUUID()}.clerk.accounts.dev`;
const ids: string[] = [];
async function fixture(scope = "independent") {
  const subject = `user_receipt_${randomUUID()}`;
  const result = await pool.query(`INSERT INTO native_account_deletions(native_issuer,native_subject,scope,target)
    VALUES($1,$2,$3,$4) RETURNING *`, [issuer, subject, scope, randomUUID()]);
  const row = result.rows[0];
  ids.push(row.id);
  return { row, who: { issuer, subject } };
}
async function state(id: string) {
  return (await pool.query("SELECT * FROM native_account_deletions WHERE id=$1", [id])).rows[0];
}
async function ready(row: { id: string; native_issuer: string; native_subject: string }) {
  await prepareNativeDeletionCompletionEmail(row, async () => "receipt@example.com");
  await pool.query("UPDATE native_account_deletions SET completed_at=NOW() WHERE id=$1", [row.id]);
}
after(async () => {
  await pool.query("DELETE FROM native_account_deletions WHERE id=ANY($1::uuid[])", [ids]);
});

test("recipient is captured once before native identity deletion and preserved across retries", async () => {
  const { row } = await fixture();
  let lookups = 0;
  await prepareNativeDeletionCompletionEmail(row, async who => {
    assert.equal(who.issuer, issuer);
    assert.equal(who.subject, row.native_subject);
    lookups++;
    return "verified@example.com";
  });
  await prepareNativeDeletionCompletionEmail(row, async () => { assert.fail("Already captured"); });
  assert.equal(lookups, 1);
  assert.equal((await state(row.id)).completion_email, "verified@example.com");
});

test("no completion email is sent until cleanup is committed; success removes the recipient", async () => {
  const { row, who } = await fixture();
  await prepareNativeDeletionCompletionEmail(row, async () => "receipt@example.com");
  let sent = 0;
  const send = async (input: { id: string; idempotencyKey: string }) => {
    assert((await state(input.id)).completed_at, "Cleanup must already be complete");
    assert.equal(input.idempotencyKey, `native-account-deleted-${row.id}`);
    sent++;
  };
  await runNativeDeletionCompletionEmails(send, who);
  assert.equal(sent, 0);
  await pool.query("UPDATE native_account_deletions SET completed_at=NOW() WHERE id=$1", [row.id]);
  await runNativeDeletionCompletionEmails(send, who);
  await runNativeDeletionCompletionEmails(send, who);
  const saved = await state(row.id);
  assert.equal(sent, 1);
  assert.equal(saved.completion_email, null);
  assert(saved.completion_email_sent_at);
});

test("email failures retry with the same idempotency key without reverting finished deletion", async () => {
  const { row, who } = await fixture();
  await ready(row);
  const keys: string[] = [];
  await runNativeDeletionCompletionEmails(async input => {
    keys.push(input.idempotencyKey);
    throw new Error("Ambiguous transport failure");
  }, who);
  const pending = await state(row.id);
  assert(pending.completed_at);
  assert.equal(pending.completion_email_sent_at, null);
  assert(pending.completion_email_first_attempt_at);
  await runNativeDeletionCompletionEmails(async input => { keys.push(input.idempotencyKey); }, who);
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal((await state(row.id)).completion_email, null);
});

test("definite first-attempt rejection stays automatically retryable", async () => {
  const { row, who } = await fixture();
  await ready(row);
  await runNativeDeletionCompletionEmails(async () => {
    throw new DeletionCompletionEmailError(true);
  }, who);
  assert.equal((await state(row.id)).completion_email_first_attempt_at, null);
  await runNativeDeletionCompletionEmails(async () => {}, who);
  assert((await state(row.id)).completion_email_sent_at);
});

test("a later definite rejection never erases an earlier ambiguous attempt", async () => {
  const { row, who } = await fixture();
  await ready(row);
  await runNativeDeletionCompletionEmails(async () => { throw new Error("Lost response"); }, who);
  const original = (await state(row.id)).completion_email_first_attempt_at;
  await runNativeDeletionCompletionEmails(async () => {
    throw new DeletionCompletionEmailError(true);
  }, who);
  assert.equal((await state(row.id)).completion_email_first_attempt_at.toISOString(), original.toISOString());
});

test("concurrent workers cannot send the same receipt twice", async () => {
  const { row, who } = await fixture();
  await ready(row);
  let calls = 0;
  const send = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 30));
  };
  await Promise.all([runNativeDeletionCompletionEmails(send, who), runNativeDeletionCompletionEmails(send, who)]);
  assert.equal(calls, 1);
});

test("uncertain old attempts require review rather than a duplicate outside the provider window", async () => {
  const { row, who } = await fixture();
  await ready(row);
  await pool.query(`UPDATE native_account_deletions
    SET completion_email_first_attempt_at=NOW()-INTERVAL '25 hours' WHERE id=$1`, [row.id]);
  await runNativeDeletionCompletionEmails(async () => { assert.fail("Unsafe duplicate"); }, who);
  assert.equal((await state(row.id)).completion_email_sent_at, null);
});

test("undeliverable contact addresses expire after seven days without claiming delivery", async () => {
  const { row, who } = await fixture();
  await ready(row);
  await pool.query("UPDATE native_account_deletions SET completed_at=NOW()-INTERVAL '8 days' WHERE id=$1", [row.id]);
  await runNativeDeletionCompletionEmails(async () => { assert.fail("Expired recipient"); }, who);
  const saved = await state(row.id);
  assert.equal(saved.completion_email, null);
  assert.equal(saved.completion_email_sent_at, null);
});

test("no verified native email does not invent a recipient or use a PWA email", async () => {
  const { row, who } = await fixture();
  await prepareNativeDeletionCompletionEmail(row, async () => null);
  await pool.query("UPDATE native_account_deletions SET completed_at=NOW() WHERE id=$1", [row.id]);
  await runNativeDeletionCompletionEmails(async () => { assert.fail("No verified recipient"); }, who);
  assert((await state(row.id)).completion_email_resolved_at);
  assert.equal((await state(row.id)).completion_email, null);
});

test("access-only completion wording explicitly preserves PWA accounts and data", () => {
  const reference = randomUUID();
  const message = deletionCompletionMessage("iphone_access", reference);
  assert.match(message.text, new RegExp(`Support reference: ${reference}`));
  assert.match(message.text, /cannot restore an account or grant access/);
  assert.match(message.subject, /access has been removed/);
  assert.match(message.text, /web\/PWA account and its data were not deleted/);
  assert.doesNotMatch(message.subject, /account has been deleted/);
  const independent = deletionCompletionMessage("independent", reference);
  assert.match(independent.subject, /account has been deleted/);
  assert.ok(independent.text.includes(reference));
});

test("Resend transport uses the configured connector and a stable idempotency key", async () => {
  await sendNativeDeletionCompletionEmail({
    id: "receipt-fixture", scope: "independent", email: "verified@example.com", idempotencyKey: "stable-fixture-key",
  }, async (connector, path, options) => {
    assert.equal(connector, "resend");
    assert.equal(path, "/emails");
    assert.equal(options?.headers?.["Idempotency-Key"], "stable-fixture-key");
    assert.deepEqual((options?.body as { to: string[] }).to, ["verified@example.com"]);
    assert.match((options?.body as { text: string }).text, /Support reference: receipt-fixture/);
    return new Response(JSON.stringify({ id: "email-fixture" }), { status: 200 });
  });
});

test("cleanup captures the email before deleting the identity and sends only afterward", async () => {
  const { row, who } = await fixture("iphone_access");
  const order: string[] = [];
  await runNativeAccountDeletions({
    prepareReceipt: async (deletion, _, tx) => {
      order.push("capture");
      await prepareNativeDeletionCompletionEmail(deletion, async () => "receipt@example.com", tx);
    },
    deleteIdentity: async () => {
      order.push("delete");
      assert.equal((await state(row.id)).completion_email, "receipt@example.com");
    },
    purgeOwner: async () => { assert.fail("Must not purge a linked PWA owner"); },
    deliverReceipts: async (_, identity) => {
      await runNativeDeletionCompletionEmails(async () => { order.push("email"); }, identity);
    },
  }, who);
  assert.deepEqual(order, ["capture", "delete", "email"]);
  assert((await state(row.id)).completed_at);
  assert((await state(row.id)).completion_email_sent_at);
});

test("Resend rejections are distinguished from an ambiguous success response", async () => {
  const input = {
    id: "receipt-fixture", scope: "independent", email: "verified@example.com", idempotencyKey: "fixture-key",
  };
  await assert.rejects(sendNativeDeletionCompletionEmail(input, async () =>
    new Response("Rate limited", { status: 429 })),
  error => error instanceof DeletionCompletionEmailError && error.definitelyNotSent);
  await assert.rejects(sendNativeDeletionCompletionEmail(input, async () =>
    new Response(JSON.stringify({ id: {} }), { status: 200 })),
  error => error instanceof DeletionCompletionEmailError && !error.definitelyNotSent);
});
