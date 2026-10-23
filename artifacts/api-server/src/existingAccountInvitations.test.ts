import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import { accountAccessTable, athleteEditorAccessTable, athleteInvitesTable, db, pool } from "@workspace/db";
import { createAthleteEditorAccessRouter } from "./routes/athleteEditorAccess";
import { requireAuth } from "./middlewares/requireAuth";

test("existing accounts explicitly accept scoped card access without losing their own permissions", async () => {
  const ids = Array.from({ length: 4 }, () => `invite-existing-${crypto.randomUUID()}`);
  const [owner, recipient, stranger, unverified] = ids;
  const email = `${crypto.randomUUID()}@example.com`;
  const users = new Map([
    [owner, { id: owner, publicMetadata: { role: "fan" }, emailAddresses: [{ emailAddress: "owner@example.com", verification: { status: "verified" } }] }],
    [recipient, { id: recipient, publicMetadata: { role: "organizer", keep: "unchanged" }, emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }] }],
    [stranger, { id: stranger, publicMetadata: {}, emailAddresses: [{ emailAddress: "stranger@example.com", verification: { status: "verified" } }] }],
    [unverified, { id: unverified, publicMetadata: {}, emailAddresses: [{ emailAddress: "unverified@example.com", verification: { status: "unverified" } }] }],
  ]);
  const originalMetadata = structuredClone(users.get(recipient)!.publicMetadata);
  const emails: unknown[] = [];
  let failEmail = false;
  let clerkInvitations = 0;
  let duringDeliveryCheck = async () => {};
  const clerk = {
    users: {
      getUser: async (id: string) => users.get(id)!,
      getUserList: async ({ emailAddress }: { emailAddress: string[] }) => ({
        data: [...users.values()].filter((u) => u.emailAddresses.some((e) => e.emailAddress === emailAddress[0])),
      }),
    },
    invitations: {
      createInvitation: async () => { clerkInvitations++; throw new Error("Existing accounts must not use Clerk signup invitations"); },
      revokeInvitation: async () => { throw new Error("Existing account must not revoke Clerk invitations"); },
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user"), tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error() {}, warn() {} };
    next();
  });
  app.get("/api/own-account", requireAuth, (_req, res) => res.json({
    userId: res.locals.clerkUserId,
    delegatedOwner: res.locals.athleteEditorAccess?.ownerClerkUserId ?? null,
  }));
  app.use("/api", createAthleteEditorAccessRouter({
    createClerk: () => clerk as never,
    sendInvitation: async (input) => {
      if (failEmail) throw new Error("Email provider unavailable");
      await duringDeliveryCheck();
      emails.push(input);
    },
  }));
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api`;
  const request = (path: string, user: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { "x-test-user": user, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    await db.insert(accountAccessTable).values(ids.map((id) => ({
      ownerClerkUserId: id, role: id === recipient ? "organizer" : "fan",
      accessMode: id === recipient ? "guest" : "full",
    })));
    const [invite, otherCard] = await db.insert(athleteInvitesTable).values([0, 1].map((i) => ({
      ownerClerkUserId: i ? stranger : owner, publicToken: `invite-existing-${crypto.randomUUID()}`,
      athleteName: i ? "Other Athlete" : "Jordan", teamName: "Comets", seasonName: "2026",
      seasonEndsAt: new Date(Date.now() + 86400_000), sport: "soccer",
      cardAppearance: { design: "velocity", jerseyNumber: "8", position: "Forward" },
    }))).returning();
    const invitationPath = `/athlete-invites/${invite.publicToken}/editor-access`;
    const send = () => request(invitationPath, owner, "POST", { emailAddress: email.toUpperCase() });
    duringDeliveryCheck = async () => {
      assert.equal((await request("/athlete-editor/access", recipient)).status, 403);
      assert.equal((await request("/athlete-editor/access/accept", recipient, "POST")).status, 403, "access cannot be accepted while email delivery is incomplete");
    };
    assert.equal((await request(invitationPath, stranger, "POST", { emailAddress: email })).status, 404);
    assert.equal((await request(invitationPath, owner, "POST", { emailAddress: "owner@example.com" })).status, 409);
    assert.equal((await request(invitationPath, owner, "POST", { emailAddress: "unverified@example.com" })).status, 409);
    assert.equal((await send()).status, 201);
    assert.equal(emails.length, 1);
    assert.equal(clerkInvitations, 0);
    assert.equal((await send()).status, 409, "duplicate sends do not send another email");
    assert.equal(emails.length, 1);
    assert.equal((await request("/athlete-editor/access", stranger)).status, 403);
    const pending = await (await request("/athlete-editor/access", recipient)).json();
    assert.equal(pending.status, "pending");
    assert.equal(pending.existingAccount, true);
    assert.equal(pending.inviteToken, invite.publicToken);
    assert.equal((await request("/athlete-editor/card/favorite-moment", recipient, "PATCH", { favoriteMoment: "Not yet" })).status, 403);
    assert.equal((await request("/athlete-editor/access/accept", stranger, "POST")).status, 403);
    users.get(recipient)!.emailAddresses[0].verification.status = "unverified";
    assert.equal((await request("/athlete-editor/access/accept", recipient, "POST")).status, 403, "a verified matching email is required at acceptance");
    users.get(recipient)!.emailAddresses[0].verification.status = "verified";
    const ownAccount = await (await request("/own-account", recipient)).json();
    assert.deepEqual(ownAccount, { userId: recipient, delegatedOwner: null });
    assert.equal((await request("/athlete-editor/access/accept", recipient, "POST")).status, 204);
    assert.equal((await request("/athlete-editor/access/accept", recipient, "POST")).status, 204, "acceptance is idempotent");
    assert.equal((await (await request("/athlete-editor/access", recipient)).json()).status, "active", "acceptance persists after reloading");
    assert.equal((await request("/athlete-editor/card/favorite-moment", recipient, "PATCH", { favoriteMoment: "Great game" })).status, 200);
    assert.equal((await request("/athlete-editor/card/appearance", recipient, "PATCH", {
      design: "velocity", borderColor: "#123456", accentColor: "#ABCDEF",
      accentLinked: false, athleteX: 0, athleteY: 0, athleteScale: 1,
      jerseyNumber: "99", position: "Goalkeeper",
    })).status, 200);
    const [saved] = await db.select().from(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal(saved.favoriteMoment, "Great game");
    assert.equal((saved.cardAppearance as any).jerseyNumber, "8", "identity stays owner-controlled");
    const [untouched] = await db.select().from(athleteInvitesTable).where(eq(athleteInvitesTable.id, otherCard.id));
    assert.equal(untouched.favoriteMoment, null);
    assert.equal((await request(`/athlete-invites/${otherCard.publicToken}/editor-access`, stranger, "POST", { emailAddress: email })).status, 409, "a second invitation cannot silently replace the selected card");
    assert.equal((await request(invitationPath, recipient, "DELETE")).status, 404, "recipient cannot manage owner invitations");
    await db.update(accountAccessTable).set({ lifecycleStatus: "paused" }).where(eq(accountAccessTable.ownerClerkUserId, recipient));
    assert.equal((await request("/athlete-editor/card/favorite-moment", recipient, "PATCH", { favoriteMoment: "Paused" })).status, 423);
    await db.update(accountAccessTable).set({ lifecycleStatus: "active" }).where(eq(accountAccessTable.ownerClerkUserId, recipient));
    assert.equal((await request(invitationPath, owner, "DELETE")).status, 204);
    assert.equal((await request("/athlete-editor/access", recipient)).status, 403);
    assert.equal((await request("/athlete-editor/access/accept", recipient, "POST")).status, 403);
    assert.equal((await request("/athlete-editor/card/favorite-moment", recipient, "PATCH", { favoriteMoment: "Revoked" })).status, 403);
    assert.equal((await request("/athlete-editor/card/appearance", recipient, "PATCH", {
      design: "velocity", borderColor: "#123456", accentColor: "#ABCDEF",
      accentLinked: false, athleteX: 0, athleteY: 0, athleteScale: 1,
      jerseyNumber: "8", position: "Forward",
    })).status, 403);
    assert.equal((await request("/own-account", recipient)).status, 200, "revocation does not lock the recipient's own account");
    failEmail = true;
    assert.equal((await send()).status, 502);
    assert.equal((await request("/athlete-editor/access/accept", recipient, "POST")).status, 403, "failed delivery leaves no acceptable invitation");
    failEmail = false;
    assert.equal((await send()).status, 201);
    assert.equal((await (await request("/athlete-editor/access", recipient)).json()).status, "pending", "reinviting requires acceptance again");
    const [account] = await db.select().from(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, recipient));
    assert.equal(account.role, "organizer");
    assert.equal(account.accessMode, "guest");
    assert.deepEqual(users.get(recipient)!.publicMetadata, originalMetadata);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await db.delete(athleteEditorAccessTable).where(inArray(athleteEditorAccessTable.ownerClerkUserId, ids));
    await db.delete(athleteInvitesTable).where(inArray(athleteInvitesTable.ownerClerkUserId, ids));
    await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, ids));
  }
});

test.after(async () => { await pool.end(); });
