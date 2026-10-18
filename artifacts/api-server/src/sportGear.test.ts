import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { accountAccessTable, athleteEditorAccessTable, athleteInvitesTable, cloudProjectsTable, db, pool, soccerGearActivityTable } from "@workspace/db";
import sportGearRouter from "./routes/sportGear";
import soccerGearRouter from "./routes/soccerGear";
import athleteInvitesRouter from "./routes/athleteInvites";
import { defaultSoccerLoadout } from "./lib/soccerGearPolicy";
import { defaultSportGearLoadout, gearSports, invalidSportGearSelection, sportGearItems } from "./lib/sportGearPolicy";

test("all sport rewards reject locked, foreign-sport, and duplicate equipment", () => {
  const empty = { activeWeeks: 0, eventCardsCreated: 0, trackerGamesCompleted: 0, hypeCardShared: false };
  const full = { activeWeeks: 3, eventCardsCreated: 10, trackerGamesCompleted: 5, hypeCardShared: true };
  for (const sport of gearSports) {
    const items = sportGearItems(sport, empty);
    assert.equal(items.length, 4);
    assert.ok(items.every((item) => !item.earned && item.id.startsWith(`${sport}-`)));
    assert.ok(invalidSportGearSelection(sport, [items[0].id], empty));
    const ids = sportGearItems(sport, full).map((item) => item.id);
    assert.equal(invalidSportGearSelection(sport, ids, full), false);
    assert.ok(invalidSportGearSelection(sport, [ids[0], ids[0]], full));
    assert.ok(invalidSportGearSelection(sport, ["another-sport-item"], full));
  }
});

test("sport gear persists, gates rewards, preserves soccer, and respects parent and athlete boundaries", { timeout: 90_000 }, async () => {
  const owner = `sport-gear-parent-${randomUUID()}`;
  const athlete = `sport-gear-athlete-${randomUUID()}`;
  const other = `sport-gear-other-${randomUUID()}`;
  const users = [owner, athlete, other];
  const token = randomUUID().replaceAll("-", "");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.header("x-test-user"), tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error() {}, warn() {}, info() {} };
    next();
  });
  app.use("/api", sportGearRouter, soccerGearRouter, athleteInvitesRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (path: string, method = "GET", data?: unknown, user = owner) => fetch(`http://127.0.0.1:${address.port}/api${path}`, {
    method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  try {
    await db.insert(accountAccessTable).values(users.map(ownerClerkUserId => ({ ownerClerkUserId, role: "fan", accessMode: "full" })));
    const [invite] = await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: owner, publicToken: token, athleteName: "Gear Player", teamName: "Rockets",
      seasonName: "Current", seasonEndsAt: new Date(Date.now() + 30 * 86400000), sport: "football",
      showHypeCard: true, showEvents: false,
    }).returning();
    const [project] = await db.insert(cloudProjectsTable).values({ ownerClerkUserId: owner, name: "Gear card", project: { tool: "hype-card" } }).returning();
    const [access] = await db.insert(athleteEditorAccessTable).values({
      ownerClerkUserId: owner, athleteInviteId: invite.id, projectId: project.id,
      athleteEmail: "sport-gear@example.com", athleteClerkUserId: athlete, status: "active",
    }).returning();
    const path = "/athlete-gear/sports/football";
    const read = async (user = owner) => {
      const response = await call(path, "GET", undefined, user);
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await call(path, "GET", undefined, "")).status, 401);
    assert.equal((await call("/athlete-gear/art/v1/private-photo.webp", "GET", undefined, "")).status, 404, "artwork route cannot serve arbitrary public or private objects");
    const artwork = await call("/athlete-gear/art/v1/football-helmet-outline.webp", "GET", undefined, "");
    assert.equal(artwork.status, 200);
    assert.equal(artwork.headers.get("content-type"), "image/webp");
    assert.ok((await artwork.arrayBuffer()).byteLength > 0);
    assert.equal((await call("/athlete-gear/sports/cricket")).status, 400);
    assert.equal((await read()).athleteId, invite.id);
    assert.ok((await read()).items.every((item: { earned: boolean }) => !item.earned));
    const save = { athleteId: invite.id, loadout: defaultSportGearLoadout(), showOnHypeCard: true };
    assert.equal((await call(path, "PUT", { ...save, loadout: { ...save.loadout, equippedGear: ["football-helmet"] } })).status, 400);
    await db.insert(soccerGearActivityTable).values([
      { ownerClerkUserId: owner, kind: "week", eventKey: "first-week" },
      { ownerClerkUserId: owner, kind: "event-card", eventKey: "first-card" },
      { ownerClerkUserId: owner, kind: "tracker-game", eventKey: "first-game" },
    ]);
    const earned = await read();
    assert.deepEqual(earned.items.filter((item: { earned: boolean }) => item.earned).map((item: { id: string }) => item.id), ["football-helmet", "football-pads", "football-gloves"]);
    const edited = { ...save, loadout: { jerseyColor: "#F36E4C", equippedGear: ["football-helmet", "football-gloves"] } };
    assert.equal((await call(path, "PUT", edited)).status, 200);
    assert.deepEqual((await read()).loadout, edited.loadout, "saved look survives a fresh read");
    assert.equal((await call(path, "PUT", edited, other)).status, 400, "another account cannot save to this athlete");
    assert.equal((await call(path, "PUT", { ...edited, loadout: { ...edited.loadout, equippedGear: ["soccer-ball"] } })).status, 400);
    const publicCard = async () => {
      const response = await call(`/athlete-invites/${token}/fan`, "GET", undefined, "");
      assert.equal(response.status, 200);
      return response.json();
    };
    const fan = await publicCard();
    assert.equal(fan.sportGear.sport, "football");
    assert.deepEqual(fan.sportGear.loadout, edited.loadout);
    assert.equal("progress" in fan.sportGear, false);
    assert.equal("ownerClerkUserId" in fan.sportGear, false);
    assert.deepEqual(fan.events, []);
    assert.equal((await call(path, "PUT", { ...edited, showOnHypeCard: false }, athlete)).status, 200);
    assert.equal((await read()).showOnHypeCard, true, "athlete cannot disable parent's sharing setting");
    assert.equal((await call("/athlete-gear/sports/soccer", "GET", undefined, athlete)).status, 403);
    assert.equal((await call(path, "PUT", { ...edited, showOnHypeCard: false })).status, 200);
    assert.equal((await publicCard()).sportGear, null);
    assert.equal((await call(path, "PUT", edited, athlete)).status, 200);
    assert.equal((await read()).showOnHypeCard, false, "athlete cannot enable parent's sharing setting");
    await db.update(athleteInvitesTable).set({ sport: "soccer" }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await call("/athlete-gear/sports/soccer", "PUT", { ...save, loadout: { jerseyColor: "#D7EF80", equippedGear: ["soccer-ball"] } })).status, 200);
    assert.equal((await call("/athlete-gear/soccer", "PUT", { ...save, loadout: defaultSoccerLoadout() })).status, 200, "legacy soccer editor remains available");
    await db.update(athleteInvitesTable).set({ sport: "football" }).where(eq(athleteInvitesTable.id, invite.id));
    assert.deepEqual((await read()).loadout, edited.loadout, "sport changes and legacy soccer saves retain football's look");
    await db.update(athleteEditorAccessTable).set({ status: "revoked" }).where(eq(athleteEditorAccessTable.id, access.id));
    assert.equal((await call(path, "GET", undefined, athlete)).status, 403);
    assert.equal((await call(path, "PUT", edited, athlete)).status, 403);
    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await call(`/athlete-invites/${token}/fan`, "GET", undefined, "")).status, 404);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await db.delete(athleteEditorAccessTable).where(inArray(athleteEditorAccessTable.ownerClerkUserId, users));
    await db.delete(athleteInvitesTable).where(inArray(athleteInvitesTable.ownerClerkUserId, users));
    await db.delete(cloudProjectsTable).where(inArray(cloudProjectsTable.ownerClerkUserId, users));
    await db.delete(soccerGearActivityTable).where(inArray(soccerGearActivityTable.ownerClerkUserId, users));
    await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, users));
  }
});

test.after(() => pool.end());
