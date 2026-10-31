import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { GAME_ON_CARD_MARKER } from "./gameOnCard";
import { nativeEventWorkspace } from "./nativeEventWorkspace";
import { applyNativeTrackerCommand, nativeSportRules, nativeWorkspaceCommand, type WorkspaceCommand } from "./nativeEventTracker";
import type { NativeIdentity } from "./nativeIdentity";
import express from "express";
import trackerRouter, { notifyStatTrackerShareUpdate } from "../routes/statTrackerShares";

const owners: string[] = [];
const denied = (status: number) => (error: any) => error.status === status;
async function fixture(sport = "soccer", type = "game") {
  const owner = `user_workspace${randomUUID().replaceAll("-", "")}`;
  owners.push(owner);
  const who: NativeIdentity = { issuer: "https://native-workspace-fixture.clerk.accounts.dev", subject: owner };
  await pool.query(`INSERT INTO account_access(owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free','active')`, [owner]);
  const linkId = (await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES ($1,$2,$2,'Workspace fixture') RETURNING id`, [who.issuer, owner])).rows[0].id as string;
  await pool.query(`INSERT INTO athlete_invites(owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
    VALUES ($1,$2,'Jordan','Tigers','Autumn 2099','2099-12-31T00:00:00Z',$3,'America/New_York')`, [owner, randomUUID(), sport]);
  const eventId = randomUUID();
  const shareToken = (await pool.query(`INSERT INTO schedule_shares(owner_clerk_user_id,title,team_season,events)
    VALUES ($1,'Tigers vs Bears',$2,$3::jsonb) RETURNING id`, [
    owner, GAME_ON_CARD_MARKER, JSON.stringify([{ id: eventId, type, date: "2099-11-01", time: "18:00", opponent: "Bears", location: "Field 2", status: "upcoming" }]),
  ])).rows[0].id as string;
  const command = (kind: WorkspaceCommand["kind"], revision: number, rest: Partial<WorkspaceCommand> = {}): WorkspaceCommand => ({
    kind, mutationId: randomUUID(), shareToken, linkId, expectedRevision: revision, ...rest,
  });
  return { owner, who, linkId, eventId, shareToken, command };
}
after(async () => {
  for (const table of ["checklist_shares", "cloud_projects", "schedule_shares", "stat_tracker_shares", "athlete_invites", "native_account_links", "account_access"]) {
    await pool.query(`DELETE FROM ${table} WHERE owner_clerk_user_id=ANY($1::text[])`, [owners]);
  }
  await pool.end();
});

test("workspace validates commands and preserves the canonical sport stat IDs and point values", async () => {
  assert.equal(nativeWorkspaceCommand.safeParse({ kind: "stat", shareToken: "bad" }).success, false);
  const path = new URL("../../../league-matrix-studio/src/features/stat-tracker.ts", import.meta.url).href;
  const canonical = await import(path);
  for (const [sport, rule] of Object.entries(nativeSportRules)) {
    for (const stat of rule.stats) {
      assert.equal(canonical.sportRules[sport].stats.find((s: any) => s.id === stat.id)?.points, stat.points, `${sport}/${stat.id}`);
    }
  }
});

test("workspace reads are private, read-only, and require an explicitly linked active account", async () => {
  const a = await fixture();
  const b = await fixture();
  const result = await nativeEventWorkspace(a.who, a.shareToken);
  assert.equal(result.sport, "soccer");
  assert.equal(result.game, null);
  assert.equal(result.trackerRevision, 0);
  assert.equal(result.prepRevision, 0);
  assert.equal((await pool.query("SELECT id FROM cloud_projects WHERE owner_clerk_user_id=$1", [a.owner])).rowCount, 0);
  await assert.rejects(nativeEventWorkspace(a.who, b.shareToken), denied(404));
  await assert.rejects(nativeEventWorkspace({ ...a.who, subject: "user_unlinked" }, a.shareToken), denied(409));
  await pool.query("UPDATE account_access SET lifecycle_status='cancelled' WHERE owner_clerk_user_id=$1", [a.owner]);
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken), denied(423));
});

test("native Prep updates the existing shared checklist, detects conflicts, and retries once", async () => {
  const a = await fixture("soccer", "practice");
  const existing = (await pool.query(`INSERT INTO checklist_shares(owner_clerk_user_id,title,items,notes,selected_game)
    VALUES ($1,'Shared practice','[]','Old note',$2::jsonb) RETURNING id`, [a.owner, JSON.stringify({ id: a.eventId })])).rows[0].id;
  const initial = await nativeEventWorkspace(a.who, a.shareToken);
  const command = a.command("prep", initial.prepRevision, {
    items: [{ id: "water", label: "Bring water", completed: true }], notes: "Meet at entrance C",
  });
  const saved = await nativeEventWorkspace(a.who, a.shareToken, command);
  assert.equal(saved.prep.notes, "Meet at entrance C");
  assert.equal(saved.prep.items[0]?.completed, true);
  assert.equal((await pool.query("SELECT id FROM checklist_shares WHERE owner_clerk_user_id=$1", [a.owner])).rows[0].id, existing);
  const retried = await nativeEventWorkspace(a.who, a.shareToken, command);
  assert.equal(retried.prepRevision, saved.prepRevision);
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("prep", 1, { items: [] })), denied(409));
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("start", 0)), denied(409));
});

test("native tracking preserves prior games, athlete attribution, revisions, and explicit final results", async () => {
  const a = await fixture();
  await pool.query(`INSERT INTO cloud_projects(owner_clerk_user_id,name,project) VALUES ($1,'Existing history',$2::jsonb)`, [
    a.owner, JSON.stringify({ tool: "stat-tracker", version: 1, customField: "keep", games: [{
      id: "old-game", sport: "soccer", status: "final", date: "2099-01-01", score: 2, opponentScore: 1, stats: {}, events: [],
    }] }),
  ]);
  const initial = await nativeEventWorkspace(a.who, a.shareToken);
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("start", initial.trackerRevision)), denied(409));
  const start = a.command("start", initial.trackerRevision, { soccerFormat: "quarters" });
  let state = await nativeEventWorkspace(a.who, a.shareToken, start);
  assert.equal(state.game?.soccerPeriodFormat, "quarters");
  const gameID = state.game?.id;
  const athleteGoal = a.command("stat", state.trackerRevision, { statId: "goal", athlete: true });
  state = await nativeEventWorkspace(a.who, a.shareToken, athleteGoal);
  assert.equal(state.game?.score, 0, "athlete-only stats must not change the team scoreboard");
  assert.equal(state.game?.scoreRecorded, false);
  assert.equal(state.game?.events[0]?.attribution, "athlete");
  state = await nativeEventWorkspace(a.who, a.shareToken, a.command("stat", state.trackerRevision, { statId: "goal", athlete: false }));
  assert.equal(state.game?.score, 1);
  const beforeRetry = state.trackerRevision;
  state = await nativeEventWorkspace(a.who, a.shareToken, athleteGoal);
  assert.equal(state.trackerRevision, beforeRetry);
  assert.equal(state.game?.events.length, 2, "a retry after another saved action must not duplicate the original tap");
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, { ...athleteGoal, statId: "assist" }), denied(409));
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("undo", 1)), denied(409));
  state = await nativeEventWorkspace(a.who, a.shareToken, a.command("undo", state.trackerRevision));
  assert.equal(state.game?.score, 0);
  assert.equal(state.game?.events.length, 1);
  state = await nativeEventWorkspace(a.who, a.shareToken, a.command("pause", state.trackerRevision));
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("stat", state.trackerRevision, { statId: "goal" })), denied(409));
  state = await nativeEventWorkspace(a.who, a.shareToken, a.command("resume", state.trackerRevision));
  state = await nativeEventWorkspace(a.who, a.shareToken, a.command("period", state.trackerRevision));
  assert.equal(state.game?.period, 2);
  await pool.query("UPDATE athlete_invites SET sport='basketball' WHERE owner_clerk_user_id=$1", [a.owner]);
  state = await nativeEventWorkspace(a.who, a.shareToken);
  assert.equal(state.sport, "soccer", "an existing game keeps its saved sport");
  const finish = a.command("finish", state.trackerRevision, { recordScore: false });
  state = await nativeEventWorkspace(a.who, a.shareToken, finish);
  assert.equal(state.game?.status, "final");
  assert.equal(state.game?.outcome, undefined, "an unrecorded 0–0 scoreboard must not become a tie");
  assert.equal(state.game?.id, gameID);
  const stored = (await pool.query("SELECT project FROM cloud_projects WHERE owner_clerk_user_id=$1", [a.owner])).rows[0].project;
  assert.equal(stored.customField, "keep");
  assert.equal(stored.games.length, 2);
  assert.equal(stored.games[0].id, "old-game");
  assert.equal((await pool.query("SELECT events FROM schedule_shares WHERE id=$1", [a.shareToken])).rows[0].events[0].status, "final");
  assert.equal((await pool.query("SELECT id FROM stat_tracker_shares WHERE owner_clerk_user_id=$1", [a.owner])).rowCount, 0, "private tracking must not create a public stats link");
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("stat", state.trackerRevision, { statId: "goal" })), denied(409));
});

test("legacy spectator games continue in one canonical cloud game without duplicates", async () => {
  const a = await fixture("volleyball");
  const game = applyNativeTrackerCommand(null, a.command("start", 0), { sport: "volleyball", eventId: a.eventId, date: "2099-11-01", opponent: "Bears" });
  delete game.sourceEventId;
  await pool.query(`INSERT INTO stat_tracker_shares(owner_clerk_user_id,game_id,athlete_name,team_name,game,expires_at)
    VALUES ($1,$2,'Jordan','Tigers',$3::jsonb,'2099-12-31')`, [a.owner, a.eventId, JSON.stringify(game)]);
  let state = await nativeEventWorkspace(a.who, a.shareToken);
  state = await nativeEventWorkspace(a.who, a.shareToken, a.command("stat", state.trackerRevision, { statId: "dig", athlete: true }));
  state = await nativeEventWorkspace(a.who, a.shareToken, a.command("stat", state.trackerRevision, { statId: "assist", athlete: true }));
  const stored = (await pool.query("SELECT project FROM cloud_projects WHERE owner_clerk_user_id=$1", [a.owner])).rows[0].project;
  assert.equal(stored.games.length, 1);
  assert.equal(stored.games[0].id, game.id);
  assert.equal(stored.games[0].events.length, 2);
});

test("link replacement and Guest mode cannot mutate another account's tools", async () => {
  const a = await fixture();
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("prep", 0, { linkId: randomUUID(), items: [] })), denied(409));
  await pool.query("UPDATE account_access SET access_mode='guest' WHERE owner_clerk_user_id=$1", [a.owner]);
  await assert.rejects(nativeEventWorkspace(a.who, a.shareToken, a.command("prep", 0, { items: [] })), denied(403));
});

test("football opponent yards stay separate and grouped undo preserves earlier plays", () => {
  const base: WorkspaceCommand = { kind: "start", mutationId: randomUUID(), shareToken: randomUUID(), linkId: randomUUID(), expectedRevision: 0 };
  const context = { sport: "football" as const, eventId: randomUUID(), date: "2099-11-01", opponent: "Bears" };
  let game = applyNativeTrackerCommand(null, base, context);
  game = applyNativeTrackerCommand(game, { ...base, kind: "stat", statId: "pass-yard", yards: 24, opponent: true }, context);
  assert.equal(game.stats["pass-yard"], undefined);
  assert.equal(game.opponentStats?.["pass-yard"], 1);
  assert.equal(game.opponentYardStats?.["pass-yard"], 24);
  game = applyNativeTrackerCommand(game, { ...base, kind: "undo" }, context);
  assert.equal(game.opponentYardStats?.["pass-yard"], 0);
  assert.equal(game.events.length, 0);
});

test("an already-open spectator stream receives a native save after commit", async () => {
  const a = await fixture("volleyball");
  const game = applyNativeTrackerCommand(null, a.command("start", 0), {
    sport: "volleyball", eventId: a.eventId, date: "2099-11-01", opponent: "Bears",
  });
  const share = (await pool.query(`INSERT INTO stat_tracker_shares(owner_clerk_user_id,game_id,athlete_name,team_name,game,expires_at)
    VALUES ($1,$2,'Jordan','Tigers',$3::jsonb,'2099-12-31') RETURNING id`,
  [a.owner, a.eventId, JSON.stringify(game)])).rows[0].id;
  const app = express();
  app.use("/api", trackerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/stat-tracker-shares/${share}/events`, { signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const nextMessage = async () => {
      while (!buffer.includes("\n\n")) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      const boundary = buffer.indexOf("\n\n");
      const result = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      return result;
    };
    let initial = await nextMessage();
    while (!initial.includes("event: stat-tracker")) initial = await nextMessage();
    const state = await nativeEventWorkspace(a.who, a.shareToken);
    await nativeEventWorkspace(a.who, a.shareToken,
      a.command("stat", state.trackerRevision, { statId: "dig", athlete: true }), notifyStatTrackerShareUpdate);
    let updated = await nextMessage();
    while (!updated.includes("event: stat-tracker")) updated = await nextMessage();
    assert.match(updated, /id: 2/);
    assert.match(updated, /"dig":1/);
  } finally {
    clearTimeout(timer);
    abort.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
