import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  db, accountAccessTable, adminActionAuditTable, adminIdentityBlocksTable,
  adminUsersTable, nativeAccountsTable, nativeAccountLinksTable,
} from "@workspace/db";
import { nativeSignupExternalId, createNativeAccountPreparation } from "./lib/nativeAccountPreparation";
import { nativeAdminUser } from "./lib/nativeAdminMembers";
import {
  getAdminMember, listAdminMembers, requestAdminMemberDeletion,
  restoreAdminMemberCancellation, updateAdminMemberAdministrator,
  updateAdminMemberIdentityBlock, updateAdminMemberProfile, updateAdminMemberSuspension,
} from "./lib/memberAdmin";
import { assertLinkableWebAccount } from "./lib/nativeAccountLink";
import memberAdminRouter from "./routes/memberAdmin";
import { GetAdminMemberResponse, ListAdminMembersResponse } from "@workspace/api-zod";

function fixtures() {
  const tag = randomUUID();
  const identity = { issuer: `https://admin-${tag}.example.com`, subject: `ios-${tag}` };
  return { tag, identity, owner: nativeSignupExternalId(identity), pwa: `pwa-${tag}`, actor: `admin-${tag}` };
}

async function seed(f: ReturnType<typeof fixtures>, provisioned = true) {
  await db.insert(nativeAccountsTable).values({
    ownerId: f.owner, nativeIssuer: f.identity.issuer, nativeSubject: f.identity.subject,
    profileMetadata: { athleteName: f.tag, displayName: "iPhone athlete", retained: "keep" },
  });
  await db.insert(nativeAccountLinksTable).values({
    nativeIssuer: f.identity.issuer, nativeSubject: f.identity.subject,
    ownerClerkUserId: f.owner, accountLabel: "iPhone account",
  });
  if (provisioned) await db.insert(accountAccessTable).values({
    ownerClerkUserId: f.owner, role: "fan", accessMode: "free",
  });
  await db.insert(accountAccessTable).values({ ownerClerkUserId: f.pwa, role: "fan", accessMode: "full" });
  await db.insert(adminUsersTable).values({ clerkUserId: f.actor });
}

async function cleanup(f: ReturnType<typeof fixtures>) {
  const ids = [f.actor, f.owner, f.pwa];
  await db.delete(nativeAccountLinksTable).where(inArray(nativeAccountLinksTable.ownerClerkUserId, ids));
  await db.delete(nativeAccountsTable).where(eq(nativeAccountsTable.ownerId, f.owner));
  await db.delete(adminIdentityBlocksTable).where(inArray(adminIdentityBlocksTable.clerkUserId, ids));
  await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, ids));
  await db.delete(adminActionAuditTable).where(inArray(adminActionAuditTable.targetClerkUserId, ids));
  await db.delete(adminUsersTable).where(inArray(adminUsersTable.clerkUserId, ids));
}

function provider(f: ReturnType<typeof fixtures>, id = f.identity.subject) {
  return {
    id, created_at: Date.now(), banned: true, locked: true,
    first_name: "Native", last_name: "Owner",
    primary_email_address_id: "email",
    email_addresses: [{ id: "email", email_address: `${f.tag}@example.com`, verification: { status: "verified" } }],
  };
}

test("native provider data never replaces the canonical owner and outages remain explicit", async () => {
  const f = fixtures();
  const row = {
    ownerId: f.owner, nativeIssuer: f.identity.issuer, nativeSubject: f.identity.subject,
    profileMetadata: { displayName: "Saved name" }, createdAt: new Date(), updatedAt: new Date(),
  };
  const user = await nativeAdminUser(row, async who => {
    assert.deepEqual(who, f.identity);
    return provider(f);
  });
  assert.equal(user.id, f.owner);
  assert.equal(user.accountSource, "native_ios");
  assert.equal(user.emailAddresses[0]?.emailAddress, `${f.tag}@example.com`);
  assert.deepEqual(user.unsafeMetadata, row.profileMetadata);
  // Banned/locked provider identities must remain visible to administrators.
  assert.equal(user.providerIdentityStatus, "available");
  for (const load of [
    async () => { throw new Error("provider unavailable"); },
    async () => provider(f, "different-subject"),
  ]) {
    const unavailable = await nativeAdminUser(row, load);
    assert.equal(unavailable.providerIdentityStatus, "unavailable");
    assert.equal(unavailable.id, f.owner);
    assert.deepEqual(unavailable.emailAddresses, []);
  }
});

test("directory includes native-only owners, separates same-email PWA, and labels legacy links", async () => {
  const f = fixtures();
  try {
    await seed(f);
    await db.insert(nativeAccountLinksTable).values({
      nativeIssuer: f.identity.issuer, nativeSubject: `legacy-${f.tag}`,
      ownerClerkUserId: f.pwa, accountLabel: "Legacy verified owner",
    });
    const pwa = {
      id: f.pwa, createdAt: Date.now(), firstName: "PWA", lastName: "Owner",
      primaryEmailAddressId: "email", emailAddresses: [{ id: "email", emailAddress: `${f.tag}@example.com` }],
      unsafeMetadata: { athleteName: "PWA athlete" },
    };
    const deps = {
      listPwaUsers: async ({ limit, offset }: { limit: number; offset: number; query?: string }) => ({
        data: offset === 0 && limit > 0 ? [pwa] : [], totalCount: 1,
      }),
      nativeUser: (row: typeof nativeAccountsTable.$inferSelect) => nativeAdminUser(row, async () => {
        if (row.ownerId !== f.owner) throw new Error("unrelated fixture");
        return provider(f);
      }),
    };
    // Unique tag matches both identities by email, without merging their owners.
    const list = ListAdminMembersResponse.parse(await listAdminMembers({ search: f.tag, limit: 20, offset: 0 }, deps));
    assert.equal(list.totalCount, 2);
    assert.deepEqual(list.items.map(user => user.clerkUserId), [f.pwa, f.owner]);
    assert.deepEqual(list.items.map(user => user.accountSource), ["legacy_linked", "native_ios"]);
    assert.equal(list.items[0]?.primaryEmailAddress, list.items[1]?.primaryEmailAddress);
    assert.equal(list.items[1]?.profile.displayName, "iPhone athlete");
    assert.equal(list.items[1]?.accessMode, "free");
    const page1 = await listAdminMembers({ search: f.tag, limit: 1, offset: 0 }, deps);
    const page2 = await listAdminMembers({ search: f.tag, limit: 1, offset: 1 }, deps);
    const page3 = await listAdminMembers({ search: f.tag, limit: 1, offset: 2 }, deps);
    assert.equal(page1.items[0]?.clerkUserId, f.pwa);
    assert.equal(page2.items[0]?.clerkUserId, f.owner);
    assert.equal(page3.items.length, 0);
    let providerCalls = 0;
    const browseDeps = {
      ...deps,
      nativeUser: async (row: typeof nativeAccountsTable.$inferSelect) => {
        providerCalls += 1;
        return deps.nativeUser(row);
      },
    };
    const webPage = await listAdminMembers({ limit: 1, offset: 0 }, browseDeps);
    assert.equal(webPage.items[0]?.clerkUserId, f.pwa);
    assert.equal(providerCalls, 0, "PWA-only pages must not fetch native provider identities");
    const ordered = await db.select({ ownerId: nativeAccountsTable.ownerId }).from(nativeAccountsTable).orderBy(nativeAccountsTable.ownerId);
    const nativeIndex = ordered.findIndex(row => row.ownerId === f.owner);
    const nativePage = await listAdminMembers({ limit: 1, offset: 1 + nativeIndex }, browseDeps);
    assert.equal(nativePage.items[0]?.clerkUserId, f.owner);
    assert.equal(nativePage.totalCount, 1 + ordered.length);
    assert.equal(providerCalls, 1, "Only the visible native row needs provider lookup");
    const detail = GetAdminMemberResponse.parse(await getAdminMember(f.owner));
    assert.equal(detail.clerkUserId, f.owner);
    assert.equal(detail.accountSource, "native_ios");
    assert.equal(detail.providerIdentityStatus, "unavailable");
    const updated = await updateAdminMemberProfile(f.actor, f.owner, { displayName: "Edited iPhone" });
    assert.equal(updated?.profile.displayName, "Edited iPhone");
    const [stored] = await db.select().from(nativeAccountsTable).where(eq(nativeAccountsTable.ownerId, f.owner));
    assert.equal(stored?.profileMetadata.retained, "keep");
    await assert.rejects(updateAdminMemberAdministrator(f.actor, f.owner, true), /PWA sign-in/);
    await assert.rejects(requestAdminMemberDeletion(f.actor, f.owner, f.owner, "Review"), /not supported/);
    // Legacy verified links keep their original PWA canonical owner. They are
    // not duplicated as an independent native account or redirected by email.
    await updateAdminMemberSuspension(f.actor, f.pwa, true, "Review legacy linked owner");
    await assert.rejects(assertLinkableWebAccount(f.pwa), /not eligible/);
    await assertLinkableWebAccount(f.owner);
    await assert.rejects(updateAdminMemberIdentityBlock(f.actor, f.pwa, true, "Review"), /suspension/);
    await updateAdminMemberSuspension(f.actor, f.pwa, false, "Legacy review complete");
  } finally { await cleanup(f); }
});

test("native suspension and cancellation restoration affect only the canonical owner", async () => {
  const f = fixtures();
  try {
    await seed(f);
    await updateAdminMemberSuspension(f.actor, f.owner, true, "Review iPhone account");
    await assert.rejects(assertLinkableWebAccount(f.owner), /not eligible/);
    await assertLinkableWebAccount(f.pwa);
    await assert.rejects(updateAdminMemberIdentityBlock(f.actor, f.owner, true, "Review"), /suspension/);
    await db.update(accountAccessTable).set({
      lifecycleStatus: "cancelled", cancelledAt: new Date(),
      deletionEligibleAt: new Date(Date.now() + 86400000),
    }).where(eq(accountAccessTable.ownerClerkUserId, f.owner));
    await restoreAdminMemberCancellation(f.actor, f.owner, "Recovery approved");
    assert.equal((await getAdminMember(f.owner))?.adminSuspended, true);
    await updateAdminMemberSuspension(f.actor, f.owner, false, "Review complete");
    await assertLinkableWebAccount(f.owner);
    assert.equal((await getAdminMember(f.owner))?.lifecycleStatus, "active");
    const [pwa] = await db.select().from(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, f.pwa));
    assert.equal(pwa?.adminSuspendedAt, null);
    assert.equal(pwa?.lifecycleStatus, "active");
    const audits = await db.select().from(adminActionAuditTable).where(eq(adminActionAuditTable.targetClerkUserId, f.owner));
    assert.deepEqual(new Set(audits.map(audit => audit.action)),
      new Set(["account_suspended", "account_reactivated", "account_cancellation_reversed"]));
  } finally { await cleanup(f); }
});

test("unprovisioned native blocks remain app-only, reversible, and isolated from PWA", async () => {
  const f = fixtures();
  try {
    await seed(f, false);
    await updateAdminMemberIdentityBlock(f.actor, f.owner, true, "Prevent setup");
    assert.equal((await getAdminMember(f.owner))?.identityBlocked, true);
    await assertLinkableWebAccount(f.pwa);
    assert.equal((await db.select().from(nativeAccountsTable).where(eq(nativeAccountsTable.ownerId, f.owner))).length, 1);
    // Re-provisioning must not bypass an existing native profile or its block.
    await db.delete(nativeAccountLinksTable).where(eq(nativeAccountLinksTable.ownerClerkUserId, f.owner));
    const prepare = createNativeAccountPreparation({
      loadIdentity: async () => { throw new Error("must not reach provider"); },
      findOwners: async () => { throw new Error("must not look up PWA"); },
    });
    await assert.rejects(prepare(f.identity), /recovery/);
    await updateAdminMemberIdentityBlock(f.actor, f.owner, false, "Review complete");
    assert.equal((await getAdminMember(f.owner))?.identityBlocked, false);
    assert.equal((await db.select().from(adminIdentityBlocksTable).where(eq(adminIdentityBlocksTable.clerkUserId, f.pwa))).length, 0);
  } finally { await cleanup(f); }
});

test("admin HTTP routes accept native canonical IDs and preserve unrelated PWA access", async () => {
  const f = fixtures();
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let server: ReturnType<typeof createServer> | undefined;
  try {
    await seed(f);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const auth = () => ({ userId: req.header("x-test-user") || undefined, tokenType: "session_token" });
      (auth as any)[Symbol.for("@clerk/express.auth")] = true;
      (req as any).auth = auth;
      next();
    });
    app.use("/api", memberAdminRouter);
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/members/${encodeURIComponent(f.owner)}`;
    const headers = { "x-test-user": f.actor, "content-type": "application/json" };
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { "x-test-user": f.pwa } })).status, 403);
    const detail = await fetch(base, { headers });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).accountSource, "native_ios");
    const suspended = await fetch(`${base}/suspension`, {
      method: "PATCH", headers, body: JSON.stringify({ suspended: true }),
    });
    assert.equal(suspended.status, 200);
    assert.equal((await suspended.json()).targetClerkUserId, f.owner);
    await assertLinkableWebAccount(f.pwa);
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, f.owner));
    const blocked = await fetch(`${base}/identity-block`, {
      method: "PATCH", headers, body: JSON.stringify({ blocked: true, reason: "Stop setup" }),
    });
    assert.equal(blocked.status, 200);
    assert.equal((await blocked.json()).targetClerkUserId, f.owner);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await cleanup(f);
  }
});
