import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { accountAccessTable, athleteEditorAccessTable, athleteInvitesTable, athleteSportGearLooksTable, cloudProjectsTable, db, pool, soccerGearActivityTable } from "@workspace/db";
import sportGearRouter from "./routes/sportGear";
import soccerGearRouter from "./routes/soccerGear";
import athleteInvitesRouter from "./routes/athleteInvites";
import { defaultSoccerLoadout } from "./lib/soccerGearPolicy";
import { defaultSportGearLoadout, gearSports, invalidSportGearSelection, sportGearItems } from "./lib/sportGearPolicy";
import { savedSportLook } from "./lib/sportGear";

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

test("baseball gear uses the new pack while keeping milestone order and migrating saved equipment", () => {
  const progress = { activeWeeks: 1, eventCardsCreated: 1, trackerGamesCompleted: 5, hypeCardShared: false };
  const items = sportGearItems("baseball", progress);
  assert.deepEqual(items.map((item) => item.id), ["baseball-glove", "baseball-bat", "baseball-ball", "baseball-jersey"]);
  assert.deepEqual(items.map((item) => item.earned), [true, true, true, true]);
  assert.deepEqual(
    savedSportLook({ sportLooks: { baseball: { jerseyColor: "#D7EF80", equippedGear: ["baseball-glove", "baseball-helmet", "baseball-cleats"] } } }, "baseball"),
    { jerseyColor: "#D7EF80", equippedGear: ["baseball-glove", "baseball-ball", "baseball-jersey"] },
  );
  assert.deepEqual(
    savedSportLook({ jerseyColor: "#2878F5", equippedGear: ["baseball-helmet", "baseball-ball"] }, "baseball").equippedGear,
    ["baseball-ball"],
    "duplicate old and current IDs collapse during migration",
  );
});

test.skip("legacy sport gear API integration is retired", { timeout: 90_000 }, async () => {
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
    const read = async (user = owner, sport = "football", name = "Gear Player") => {
      const response = await call(`/athlete-gear/sports?sport=${sport}&athleteName=${encodeURIComponent(name)}`, "GET", undefined, user);
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await call("/athlete-gear/sports?sport=football&athleteName=Gear%20Player", "GET", undefined, "")).status, 401);
    assert.equal((await call("/athlete-gear/art/v1/private-photo.webp", "GET", undefined, "")).status, 404, "artwork route cannot serve arbitrary public or private objects");
    for (const filename of [
      "football-helmet-outline.webp",
      "baseball-ball-pack.webp",
      "baseball-ball-pack-outline.webp",
      "baseball-bat-pack.webp",
      "baseball-bat-pack-outline.webp",
      "baseball-glove-pack.webp",
      "baseball-glove-pack-outline.webp",
      "baseball-jersey-pack.webp",
      "baseball-jersey-pack-outline.webp",
    ]) {
      const artwork = await call(`/athlete-gear/art/v1/${filename}`, "GET", undefined, "");
      assert.equal(artwork.status, 200, `${filename} is stored in the curated public art folder`);
      assert.equal(artwork.headers.get("content-type"), "image/webp");
      assert.ok((await artwork.arrayBuffer()).byteLength > 0);
    }
    assert.equal((await call("/athlete-gear/sports?sport=cricket")).status, 400);
    assert.equal((await read()).athleteId, invite.id);
    assert.equal((await read(owner, "soccer")).athleteId, null, "the selected athlete name is not matched to a different athlete's soccer HYPE Card");
    assert.equal((await read(owner, "football", "Other Player")).canSave, true, "saving is not conditional on a matching HYPE Card");
    assert.equal((await call("/athlete-gear/sports?sport=soccer&athleteName=Gear%20Player", "GET", undefined, athlete)).status, 403);
    assert.ok((await read()).items.every((item: { earned: boolean }) => !item.earned));
    const save = { athleteName: "Gear Player", loadout: defaultSportGearLoadout() };
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
    assert.equal((await call(path, "PUT", { loadout: defaultSportGearLoadout() }, other)).status, 200, "a different account can save its own independent look");
    assert.deepEqual((await read()).loadout, edited.loadout, "saving another profile's look leaves this account unchanged");
    assert.equal((await call(path, "PUT", { ...edited, loadout: { ...edited.loadout, equippedGear: ["soccer-ball"] } })).status, 400);
    const publicCard = async () => {
      const response = await call(`/athlete-invites/${token}/fan`, "GET", undefined, "");
      assert.equal(response.status, 200);
      return response.json();
    };
    const fan = await publicCard();
    assert.equal("sportGear" in fan, false, "the HYPE Card contract never includes earned sports gear");
    const showcaseGearResponse = await call(`/athlete-invites/${token}/jersey-showcase/gear`, "GET", undefined, "");
    assert.equal(showcaseGearResponse.status, 200);
    const showcaseGear = await showcaseGearResponse.json();
    assert.equal(showcaseGear.sport, "football");
    assert.deepEqual(showcaseGear.loadout, edited.loadout);
    assert.deepEqual(showcaseGear.earnedGear, ["football-helmet", "football-pads", "football-gloves"]);
    assert.equal("progress" in showcaseGear, false);
    assert.equal("ownerClerkUserId" in showcaseGear, false);
    assert.deepEqual(fan.events, []);
    await db.update(athleteInvitesTable).set({ showHypeCard: false }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await call(`/athlete-invites/${token}/jersey-showcase/gear`, "GET", undefined, "")).status, 200, "Showcase gear remains public when HYPE Card sharing is turned off");
    await db.update(athleteInvitesTable).set({ showHypeCard: true }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await call(path, "PUT", edited, athlete)).status, 200);
    assert.deepEqual((await read()).loadout, edited.loadout, "athlete edits update the owner's profile-level gear look");

    const noCard = await read(other, "football", "Independent Player");
    assert.equal(noCard.canSave, true);
    assert.equal(noCard.athleteId, null, "the profile has no HYPE Card");
    assert.ok(noCard.items.every((item: { earned: boolean }) => !item.earned));
    await db.insert(soccerGearActivityTable).values([
      { ownerClerkUserId: other, kind: "week", eventKey: "no-card-week" },
      { ownerClerkUserId: other, kind: "event-card", eventKey: "no-card-event" },
      { ownerClerkUserId: other, kind: "tracker-game", eventKey: "no-card-game" },
    ]);
    const independentSave = {
      athleteName: "Independent Player",
      loadout: { jerseyColor: "#D7EF80", equippedGear: ["football-helmet"] },
    };
    assert.equal((await call(path, "PUT", independentSave, other)).status, 200, "a profile without a HYPE Card can save earned gear");
    assert.deepEqual((await read(other, "football", "Independent Player")).loadout, independentSave.loadout);
    assert.deepEqual((await read()).loadout, edited.loadout, "another profile's gear does not leak across accounts");
    await db.update(athleteInvitesTable).set({ sport: "soccer" }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await call("/athlete-gear/sports/soccer", "PUT", { ...save, loadout: { jerseyColor: "#D7EF80", equippedGear: ["soccer-ball"] } })).status, 200);
    assert.equal((await call("/athlete-gear/soccer", "PUT", {
      athleteId: invite.id, loadout: defaultSoccerLoadout(), showOnHypeCard: true,
    })).status, 200, "legacy soccer editor remains available");
    assert.equal((await read(owner, "soccer")).athleteId, invite.id);
    await db.update(athleteInvitesTable).set({ sport: "football" }).where(eq(athleteInvitesTable.id, invite.id));
    assert.deepEqual((await read()).loadout, edited.loadout, "sport changes and legacy soccer saves retain football's look");
    await db.update(athleteEditorAccessTable).set({ status: "revoked" }).where(eq(athleteEditorAccessTable.id, access.id));
    assert.equal((await call("/athlete-gear/sports?sport=football&athleteName=Gear%20Player", "GET", undefined, athlete)).status, 403);
    assert.equal((await call(path, "PUT", edited, athlete)).status, 403);
    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await call(`/athlete-invites/${token}/fan`, "GET", undefined, "")).status, 404);
    assert.equal((await call(`/athlete-invites/${token}/jersey-showcase/gear`, "GET", undefined, "")).status, 404);
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invite.id));
    assert.equal((await read()).athleteId, null);
    assert.deepEqual((await read()).loadout, edited.loadout, "deleting the HYPE Card does not delete the profile's saved gear");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await db.delete(athleteEditorAccessTable).where(inArray(athleteEditorAccessTable.ownerClerkUserId, users));
    await db.delete(athleteSportGearLooksTable).where(inArray(athleteSportGearLooksTable.ownerClerkUserId, users));
    await db.delete(athleteInvitesTable).where(inArray(athleteInvitesTable.ownerClerkUserId, users));
    await db.delete(cloudProjectsTable).where(inArray(cloudProjectsTable.ownerClerkUserId, users));
    await db.delete(soccerGearActivityTable).where(inArray(soccerGearActivityTable.ownerClerkUserId, users));
    await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, users));
  }
});

test.after(() => pool.end());
