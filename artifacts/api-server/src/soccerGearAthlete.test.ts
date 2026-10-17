import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { accountAccessTable, athleteEditorAccessTable, athleteInvitesTable, cloudProjectsTable, db, pool, soccerGearActivityTable } from "@workspace/db";
import soccerGearRouter from "./routes/soccerGear";
import { defaultSoccerLoadout } from "./lib/soccerGearPolicy";

test("parent and athlete share one kit without delegating visibility or milestones", async () => {
  const owner = `kit-parent-${randomUUID()}`;
  const athlete = `kit-athlete-${randomUUID()}`;
  const other = `kit-other-${randomUUID()}`;
  const users = [owner, athlete, other];
  let accessId: string | undefined;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user"), tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error() {}, warn() {} };
    next();
  });
  app.use("/api", soccerGearRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (user: string, method = "GET", data?: unknown, suffix = "") => fetch(
    `http://127.0.0.1:${address.port}/api/athlete-gear/soccer${suffix}`, {
      method, headers: { "content-type": "application/json", "x-test-user": user },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  try {
    await db.insert(accountAccessTable).values(users.map(ownerClerkUserId => ({ ownerClerkUserId, role: "fan", accessMode: "full" })));
    const invites = await db.insert(athleteInvitesTable).values([owner, other].map(ownerClerkUserId => ({
      ownerClerkUserId, publicToken: randomUUID(), athleteName: "Kit Player",
      teamName: "Soccer", seasonName: "Current", seasonEndsAt: new Date(Date.now() + 86400000), sport: "soccer",
    }))).returning();
    const [project] = await db.insert(cloudProjectsTable).values({
      ownerClerkUserId: owner, name: "Athlete card", project: { tool: "hype-card" },
    }).returning();
    const [access] = await db.insert(athleteEditorAccessTable).values({
      ownerClerkUserId: owner, athleteInviteId: invites[0].id, projectId: project.id,
      athleteEmail: "kit@example.com", athleteClerkUserId: athlete, status: "active",
    }).returning();
    accessId = access.id;
    const read = async (user: string) => {
      const response = await call(user);
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await read(athlete)).athleteId, invites[0].id);
    const save = { athleteId: invites[0].id, loadout: defaultSoccerLoadout(), showOnHypeCard: true };
    assert.equal((await call(owner, "PUT", save)).status, 200);
    const edited = { ...save, showOnHypeCard: false, loadout: { ...save.loadout, jerseyColor: "#F36E4C" } };
    assert.equal((await call(athlete, "PUT", edited)).status, 200);
    assert.equal((await read(owner)).loadout.jerseyColor, "#F36E4C");
    assert.equal((await read(athlete)).showOnHypeCard, true, "athlete cannot disable parent visibility");
    assert.equal((await call(athlete, "PUT", { ...edited, athleteId: invites[1].id })).status, 403);
    for (const user of [owner, athlete]) {
      assert.equal((await call(user, "PUT", { ...save, loadout: { ...save.loadout, jerseyStyle: "stripes" } })).status, 400);
    }
    assert.equal((await call(athlete, "POST", {}, "/activity")).status, 403);
    assert.equal((await call(athlete, "POST", { shareToken: invites[0].publicToken }, "/share-action")).status, 403);
    await db.insert(soccerGearActivityTable).values(Array.from({ length: 10 }, (_, i) => ({
      ownerClerkUserId: owner, kind: "event-card", eventKey: `saved-${i}`,
    })));
    assert.equal((await call(athlete, "PUT", { ...edited, loadout: { ...edited.loadout, jerseyStyle: "stripes" } })).status, 200);
    assert.equal((await read(owner)).loadout.jerseyStyle, "stripes");
    assert.equal((await call(owner, "PUT", { ...save, showOnHypeCard: false })).status, 200);
    assert.equal((await call(athlete, "PUT", save)).status, 200);
    assert.equal((await read(owner)).showOnHypeCard, false, "athlete cannot enable parent visibility");
    await db.delete(cloudProjectsTable).where(eq(cloudProjectsTable.id, project.id));
    assert.equal((await call(athlete)).status, 403, "deleted linked project closes kit access");
    await db.update(athleteEditorAccessTable).set({ status: "revoked" }).where(eq(athleteEditorAccessTable.id, access.id));
    assert.equal((await call(athlete)).status, 403);
    assert.equal((await call(athlete, "PUT", save)).status, 403);
    assert.equal((await read(other)).loadout.jerseyColor, "#2878F5");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (accessId) await db.delete(athleteEditorAccessTable).where(eq(athleteEditorAccessTable.id, accessId));
    await db.delete(athleteInvitesTable).where(inArray(athleteInvitesTable.ownerClerkUserId, users));
    await db.delete(cloudProjectsTable).where(inArray(cloudProjectsTable.ownerClerkUserId, users));
    await db.delete(soccerGearActivityTable).where(inArray(soccerGearActivityTable.ownerClerkUserId, users));
    await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, users));
  }
});

test.after(() => pool.end());
