import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after } from "node:test";
import express from "express";
import { pool } from "@workspace/db";
import memberAdminRouter from "./routes/memberAdmin";
import { nativeDeletionMailStage } from "./lib/adminNativeDeletionEmails";

after(() => pool.end());

test("mail stages respect cleanup, provider acceptance, ambiguity and exact safety boundaries", () => {
  const now = Date.now();
  const row = {
    id: randomUUID(), scope: "independent" as const, requested_at: new Date(now),
    completed_at: null as Date | null, has_contact: true,
    completion_email_first_attempt_at: null as Date | null,
    completion_email_last_attempt_at: null,
    completion_email_sent_at: null as Date | null,
  };
  assert.equal(nativeDeletionMailStage(row, now), "awaiting_cleanup");
  row.completed_at = new Date(now);
  assert.equal(nativeDeletionMailStage(row, now), "waiting_to_send");
  // Even a recent in-flight attempt cannot be represented as definitely unsent.
  row.completion_email_first_attempt_at = new Date(now);
  assert.equal(nativeDeletionMailStage(row, now), "delivery_uncertain");
  assert.equal(nativeDeletionMailStage(row, now + 23 * 3600000 - 1), "delivery_uncertain");
  assert.equal(nativeDeletionMailStage(row, now + 23 * 3600000), "review_required");
  assert.equal(nativeDeletionMailStage(row, now + 7 * 86400000 + 1), "contact_retention_expired");
  // A cleared address alone is not proof of a send.
  row.has_contact = false;
  row.completion_email_first_attempt_at = null;
  assert.equal(nativeDeletionMailStage(row, now), "no_verified_contact");
  row.completion_email_sent_at = new Date(now);
  assert.equal(nativeDeletionMailStage(row, now + 8 * 86400000), "provider_accepted");
});

test("admin-only redacted list works for deleted identities, paginates, and is strictly read-only", async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const admin = `deleted-mail-admin-${randomUUID()}`;
  const issuer = `https://deleted-mail-${randomUUID()}.example.com`;
  const refs: string[] = [];
  const server = createServer();
  try {
    await pool.query("INSERT INTO admin_users(clerk_user_id) VALUES($1)", [admin]);
    const stages = [
      { stage: "awaiting_cleanup", completed: null, first: null, sent: null, contact: true },
      { stage: "waiting_to_send", completed: "1 hour", first: null, sent: null, contact: true },
      { stage: "provider_accepted", completed: "8 days", first: "8 days", sent: "8 days", contact: false },
      { stage: "delivery_uncertain", completed: "2 hours", first: "1 hour", sent: null, contact: true },
      { stage: "review_required", completed: "2 days", first: "24 hours", sent: null, contact: true },
      { stage: "contact_retention_expired", completed: "8 days", first: "8 days", sent: null, contact: false },
      { stage: "no_verified_contact", completed: "1 hour", first: null, sent: null, contact: false },
    ];
    for (const [index, fixture] of stages.entries()) {
      const inserted = await pool.query(`INSERT INTO native_account_deletions(
        native_issuer,native_subject,owner_id,scope,target,requested_at,completed_at,
        completion_email,completion_email_resolved_at,completion_email_first_attempt_at,
        completion_email_last_attempt_at,completion_email_sent_at)
        VALUES($1,$2,$3,$4,$3,NOW()+INTERVAL '1 day'+($5::int*INTERVAL '1 second'),
          NOW()-$6::interval,$7,NOW(),NOW()-$8::interval,NOW()-$8::interval,NOW()-$9::interval)
        RETURNING id`, [
        issuer, `removed-subject-${index}`, `removed-owner-${index}`,
        index % 2 ? "iphone_access" : "independent", index,
        fixture.completed, fixture.contact ? "private-retained-recipient@example.com" : null,
        fixture.first, fixture.sent,
      ]);
      refs.push(inserted.rows[0].id);
    }
    // These tombstones deliberately have no native profile or provider user.
    const before = (await pool.query("SELECT * FROM native_account_deletions WHERE id=ANY($1::uuid[]) ORDER BY id", [refs])).rows;
    const app = express();
    app.use((req, _res, next) => {
      const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
      (auth as any)[Symbol.for("@clerk/express.auth")] = true;
      (req as any).auth = auth;
      next();
    });
    app.use("/api", memberAdminRouter);
    server.on("request", app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/native-deletion-emails`;
    const headers = { "x-test-user": admin };
    assert.equal((await fetch(url)).status, 401);
    const forbidden = await fetch(url, { headers: { "x-test-user": "ordinary-member" } });
    assert.equal(forbidden.status, 403);
    assert.doesNotMatch(await forbidden.text(), new RegExp(refs.join("|")));
    const response = await fetch(`${url}?limit=100`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /private-retained-recipient|removed-subject|removed-owner|native_issuer|native_subject|completion_email|has_contact|@example\.com/);
    assert.ok(!text.includes(issuer));
    stages.forEach((fixture, index) => {
      const item = body.items.find((item: { reference: string }) => item.reference === refs[index]);
      assert.ok(item, `Missing tombstone ${index}`);
      assert.equal(item.stage, fixture.stage);
      assert.deepEqual(Object.keys(item).sort(), [
        "reference", "scope", "stage", "requestedAt", "completedAt", "firstAttemptAt", "lastAttemptAt", "providerAcceptedAt",
      ].sort());
    });
    const page = await (await fetch(`${url}?limit=2&offset=2`, { headers })).json();
    assert.deepEqual(page.items.map((item: { reference: string }) => item.reference), [refs[4], refs[3]]);
    assert.equal(page.limit, 2);
    assert.equal(page.offset, 2);
    for (const invalid of ["limit=0", "limit=101", "offset=-1", "limit=1.5", "offset=1000001"]) {
      assert.equal((await fetch(`${url}?${invalid}`, { headers })).status, 400);
    }
    for (const method of ["POST", "PATCH", "DELETE"]) {
      assert.equal((await fetch(url, { headers, method })).status, 404);
    }
    assert.deepEqual((await pool.query("SELECT * FROM native_account_deletions WHERE id=ANY($1::uuid[]) ORDER BY id", [refs])).rows, before);
    process.env.NODE_ENV = "development";
    assert.equal((await fetch(url, { headers })).status, 403);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.query("DELETE FROM native_account_deletions WHERE native_issuer=$1", [issuer]);
    await pool.query("DELETE FROM admin_users WHERE clerk_user_id=$1", [admin]);
  }
});
