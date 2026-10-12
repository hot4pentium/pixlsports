import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  accountAccessTable, athleteInvitesTable, db, pool, scheduleSharesTable, soccerGearActivityTable,
} from "@workspace/db";
import soccerGearRouter from "./routes/soccerGear";
import scheduleSharesRouter from "./routes/scheduleShares";
import athleteInvitesRouter from "./routes/athleteInvites";
import { defaultSoccerLoadout, lockedSoccerSelection, soccerWeekKey, unlockedSoccerGear } from "./lib/soccerGearPolicy";

test("weekly boundaries are distinct Monday–Sunday UTC weeks, including year rollover", () => {
  assert.equal(soccerWeekKey(new Date("2026-10-11T23:59:59.999Z")), "2026-10-05");
  assert.equal(soccerWeekKey(new Date("2026-10-12T00:00:00.000Z")), "2026-10-12");
  assert.equal(soccerWeekKey(new Date("2027-01-01T14:00:00Z")), "2026-12-28");
  assert.equal(lockedSoccerSelection({ ...defaultSoccerLoadout(), sweatband: "head" }, []), "sweatbands");
  assert.deepEqual(unlockedSoccerGear({ activeWeeks: 3, eventCardsCreated: 10, hypeCardShared: true }), [
    "speed-cleats", "striped-socks", "contrast-shorts", "stripe-jersey", "sweatbands",
  ]);
});

test("real gear routes persist and isolate looks, deduplicate successful actions, and control public visibility", { timeout: 90_000 }, async () => {
  const owners = [`gear-test-${randomUUID()}`, `gear-test-${randomUUID()}`];
  const tokens = [randomUUID().replaceAll("-", ""), randomUUID().replaceAll("-", "")];
  const invites = await db.insert(athleteInvitesTable).values(owners.map((owner, i) => ({
    ownerClerkUserId: owner, publicToken: tokens[i], athleteName: `Player ${i + 1}`,
    teamName: "Soccer", seasonName: "Current", seasonEndsAt: new Date(Date.now() + 86400000),
    sport: "soccer", paused: false,
  }))).returning();
  await db.insert(accountAccessTable).values(owners.map((owner) => ({
    ownerClerkUserId: owner, role: "fan", accessMode: "full", lifecycleStatus: "active",
  })));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: req.headers["x-test-owner"], tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error() {}, warn() {}, info() {} };
    next();
  });
  app.use("/api", soccerGearRouter, scheduleSharesRouter, athleteInvitesRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const call = (path: string, method = "GET", data?: unknown, owner: string | undefined = owners[0]) => fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(owner ? { "x-test-owner": owner } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const gear = async (owner = owners[0]) => (await call("/athlete-gear/soccer", "GET", undefined, owner)).json();
  try {
    assert.equal((await fetch(base + "/athlete-gear/soccer")).status, 401);
    const initial = await gear();
    assert.equal(initial.athleteId, invites[0].id);
    assert.equal(initial.showOnHypeCard, false);
    assert.equal(initial.progress.activeWeeks, 0);
    const baseSave = { athleteId: invites[0].id, loadout: defaultSoccerLoadout(), showOnHypeCard: false };
    assert.equal((await call("/athlete-gear/soccer", "PUT", {
      ...baseSave, loadout: { ...baseSave.loadout, jerseyStyle: "stripes" },
    })).status, 400, "server rejects locked styles");
    await Promise.all(Array.from({ length: 8 }, () => call("/athlete-gear/soccer/activity", "POST")));
    assert.equal((await gear()).progress.activeWeeks, 1);
    const createCard = async (eventId: string) => {
      const response = await call("/schedule-shares", "POST", {
        title: "Soccer", teamSeason: "", purpose: "game-on-card",
        events: [{ id: eventId, type: "game", status: "upcoming", date: "2099-04-01",
          time: "12:00", timezone: "UTC", location: "Field", opponent: "Visitors",
          snacks: "", drinks: "", notes: "" }],
      });
      assert.equal(response.status, 201, await response.clone().text());
      return response.json();
    };
    const first = await createCard("event-0");
    await Promise.all(Array.from({ length: 5 }, () => createCard("event-0")));
    assert.equal((await gear()).progress.eventCardsCreated, 1, "request retries never count as new events");
    assert.equal((await call(`/schedule-shares/${first.shareToken}`, "PATCH", {
      title: "Edited", teamSeason: "", purpose: "game-on-card",
      events: first.events,
    })).status, 200);
    assert.equal((await gear()).progress.eventCardsCreated, 1, "edits award nothing");
    for (let i = 1; i < 10; i++) await createCard(`event-${i}`);
    await call(`/schedule-shares/${first.shareToken}`, "DELETE");
    assert.equal((await gear()).progress.eventCardsCreated, 10, "deletion does not remove earned progress");
    assert.equal((await call("/athlete-gear/soccer/share-action", "POST", { shareToken: tokens[1] })).status, 404);
    await db.update(athleteInvitesTable).set({ seasonEndsAt: new Date(Date.now() - 86400000) })
      .where(eq(athleteInvitesTable.id, invites[0].id));
    assert.equal((await call("/athlete-gear/soccer/share-action", "POST", { shareToken: tokens[0] })).status, 200,
      "a still-public original HYPE Card qualifies even after its season ends");
    await Promise.all(Array.from({ length: 5 }, () => call("/athlete-gear/soccer/share-action", "POST", { shareToken: tokens[0] })));
    const credits = await db.select().from(soccerGearActivityTable).where(eq(soccerGearActivityTable.ownerClerkUserId, owners[0]));
    assert.equal(credits.filter((item) => item.kind === "share").length, 1);
    const saved = { ...baseSave, loadout: { ...baseSave.loadout, jerseyStyle: "stripes", jerseyColor: "#F36E4C", sweatband: "wrist", shinGuards: "shield" } };
    assert.equal((await call("/athlete-gear/soccer", "PUT", saved)).status, 200);
    assert.equal((await gear()).loadout.jerseyColor, "#F36E4C");
    const publicCard = () => call(`/athlete-invites/${tokens[0]}/fan`, "GET", undefined, "");
    assert.equal((await (await publicCard()).json()).soccerGear, null);
    assert.equal((await call("/athlete-gear/soccer", "PUT", { ...saved, showOnHypeCard: true })).status, 200);
    assert.equal((await (await publicCard()).json()).soccerGear.jerseyColor, "#F36E4C");
    assert.equal((await gear(owners[1])).progress.eventCardsCreated, 0);
    assert.equal((await gear(owners[1])).loadout.jerseyColor, "#2878F5");
    assert.equal((await call("/athlete-gear/soccer", "PUT", saved, owners[1])).status, 400, "athlete ids cannot cross accounts");
    await db.update(athleteInvitesTable).set({ paused: true }).where(eq(athleteInvitesTable.id, invites[0].id));
    assert.equal((await publicCard()).status, 404, "parent pause removes the kit with the card");
    await db.delete(athleteInvitesTable).where(eq(athleteInvitesTable.id, invites[0].id));
    const [replacement] = await db.insert(athleteInvitesTable).values({
      ownerClerkUserId: owners[0], publicToken: randomUUID().replaceAll("-", ""),
      athleteName: "New athlete", teamName: "Soccer", seasonName: "Current", sport: "soccer",
      seasonEndsAt: new Date(Date.now() + 86400000),
    }).returning();
    const nextAthlete = await gear();
    assert.equal(nextAthlete.athleteId, replacement.id);
    assert.equal(nextAthlete.showOnHypeCard, false);
    assert.equal(nextAthlete.loadout.jerseyColor, "#2878F5", "new athlete does not inherit another athlete's look");
    assert.equal((await call("/athlete-gear/soccer", "PUT", saved)).status, 400, "stale athlete save is rejected");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(athleteInvitesTable).where(inArray(athleteInvitesTable.ownerClerkUserId, owners));
    await db.delete(scheduleSharesTable).where(inArray(scheduleSharesTable.ownerClerkUserId, owners));
    await db.delete(soccerGearActivityTable).where(inArray(soccerGearActivityTable.ownerClerkUserId, owners));
    await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, owners));
  }
});

test.after(() => pool.end());
