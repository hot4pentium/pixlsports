import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  applyNativeTrackerCommand, nativeSportRules, nativeWorkspaceCommand,
  type NativeGame, type NativePlay, type NativeSport, type WorkspaceCommand,
} from "./nativeEventTracker";

const command = (kind: WorkspaceCommand["kind"], rest: Partial<WorkspaceCommand> = {}): WorkspaceCommand => ({
  shareToken: randomUUID(), mutationId: randomUUID(), linkId: randomUUID(),
  expectedRevision: 0, kind, ...(kind === "stat" ? { scoringVersion: 2 as const } : {}), ...rest,
});
const context = (sport: NativeSport) => ({
  sport, eventId: randomUUID(), date: "2099-11-01", opponent: "Bears",
});
const start = (sport: NativeSport) => applyNativeTrackerCommand(
  null, command("start", sport === "soccer" ? { soccerFormat: "halves" } : {}), context(sport),
);
const apply = (game: NativeGame, kind: WorkspaceCommand["kind"], rest: Partial<WorkspaceCommand> = {}) =>
  applyNativeTrackerCommand(game, command(kind, rest), context(game.sport));

test("every sport stat adds its points once for athlete or team without losing attribution", () => {
  for (const sport of Object.keys(nativeSportRules) as NativeSport[]) {
    for (const stat of nativeSportRules[sport].stats) {
      for (const athlete of [true, false]) {
        const before = start(sport);
        const game = apply(before, "stat", { statId: stat.id, athlete });
        const label = `${sport}/${stat.id}/${athlete ? "athlete" : "team"}`;
        assert.equal(game.score, stat.points, label);
        assert.equal(game.stats[stat.id], 1, `${label}: one combined team event`);
        assert.equal(game.events.length, 1);
        assert.equal(game.events[0]!.attribution, athlete ? "athlete" : "team");
        assert.equal(game.events[0]!.scoreDelta, stat.points);
        assert.equal(game.events.filter((p) => p.attribution === "athlete").length, athlete ? 1 : 0);
        assert.equal(game.opponentScore, 0);
        assert.equal(game.scoreRecorded, stat.points > 0);
        assert.equal(before.score, 0, "the original saved game is not mutated");
        const undone = apply(game, "undo");
        assert.equal(undone.score, 0, `${label}: undo removes the point contribution once`);
        assert.equal(undone.stats[stat.id], 0);
        assert.equal(undone.events.length, 0);
      }
    }
  }
});

test("athlete and team touchdowns share one scoreboard; manual adjustment stays independent", () => {
  let game = apply(start("football"), "stat", { statId: "touchdown", athlete: true });
  assert.equal(game.score, 6);
  game = apply(game, "stat", { statId: "touchdown", athlete: false });
  assert.equal(game.score, 12);
  assert.equal(game.stats.touchdown, 2);
  assert.equal(game.events.filter((p) => p.attribution === "athlete").length, 1);
  game = apply(game, "score", { delta: 1 });
  game = apply(game, "undo");
  assert.equal(game.score, 7, "undoing the team touchdown preserves the independent +1 correction");
  game = apply(game, "undo");
  assert.equal(game.score, 1);
});

test("opponent football scoring never changes athlete or home-team totals", () => {
  let game = apply(start("football"), "stat", { statId: "touchdown", athlete: true });
  game = apply(game, "stat", { statId: "touchdown", athlete: true, opponent: true });
  assert.equal(game.score, 6);
  assert.equal(game.opponentScore, 6);
  assert.equal(game.stats.touchdown, 1);
  assert.equal(game.opponentStats?.touchdown, 1);
  assert.equal(game.events[1]!.attribution, "team");
  assert.equal(game.events[1]!.possessionSide, "opponent");
  game = apply(game, "undo");
  assert.equal(game.score, 6);
  assert.equal(game.opponentScore, 0);
  assert.equal(game.events.filter((p) => p.attribution === "athlete").length, 1);
});

test("old queued commands retain their old points and fingerprint", () => {
  const old = command("stat", { statId: "touchdown", athlete: true });
  delete old.scoringVersion;
  const parsed = nativeWorkspaceCommand.parse(old);
  const oldSchema = nativeWorkspaceCommand.omit({ scoringVersion: true });
  assert.equal(JSON.stringify(parsed), JSON.stringify(oldSchema.parse(old)),
    "adding an optional schema field must not change old receipt digests");
  assert.equal(Object.hasOwn(parsed, "scoringVersion"), false);
  const game = applyNativeTrackerCommand(start("football"), parsed, context("football"));
  assert.equal(game.score, 0, "a restored legacy action must not silently acquire new scoring semantics");
  assert.equal(game.events[0]!.scoreDelta, 0);
  assert.equal(apply(game, "undo").score, 0);
  for (const scoringVersion of [null, 0, 1, 3, "2"]) {
    assert.equal(nativeWorkspaceCommand.safeParse({ ...old, scoringVersion }).success, false);
  }
  assert.equal(nativeWorkspaceCommand.safeParse({ ...old, scoreDelta: 99 }).success, false,
    "score contribution is server-owned, not a client-supplied points override");
});

test("historical events are not recalculated and undo respects explicit zero or recorded deltas", () => {
  const historical = start("football");
  historical.score = 12;
  historical.stats = { touchdown: 1 };
  historical.events = [{
    id: randomUUID(), statId: "touchdown", attribution: "athlete", period: 1, createdAt: "2099-01-01",
  }];
  const continued = apply(historical, "stat", { statId: "touchdown", athlete: true });
  assert.equal(continued.score, 18, "only the newly entered play adds points");
  assert.equal(continued.events[0]!.scoreDelta, undefined);
  assert.equal(apply(apply(continued, "undo"), "undo").score, 12,
    "undoing the old athlete touchdown must not subtract unrecorded points");
  for (const [attribution, scoreDelta, expected] of [
    ["athlete", 3, 9], ["team", 0, 12], ["team", undefined, 6],
  ] as const) {
    const game = structuredClone(historical);
    game.events[0] = { ...game.events[0]!, attribution, scoreDelta };
    assert.equal(apply(game, "undo").score, expected);
  }
});

test("grouped undo combines legacy and new score contributions without removing manual corrections", () => {
  const play = (statId: string, attribution: string, rest: Partial<NativePlay> = {}): NativePlay => ({
    id: randomUUID(), statId, attribution, period: 1, createdAt: "2099-01-01", playId: "one-play", ...rest,
  });
  const game = start("football");
  game.score = 15; // 13 contributed points and an independent +2 correction.
  game.opponentScore = 9; // Six contributed points and an independent +3.
  game.stats = { touchdown: 3, "extra-point": 1, reception: 1 };
  game.opponentStats = { touchdown: 1 };
  game.events = [
    play("touchdown", "athlete"), // Legacy athlete scoring contributed zero.
    play("touchdown", "team"), // Legacy team scoring contributed six.
    play("touchdown", "athlete", { scoreDelta: 6 }),
    play("extra-point", "team", { scoreDelta: 1 }),
    play("reception", "athlete", { scoreDelta: 0 }),
    play("touchdown", "team", { possessionSide: "opponent", scoreDelta: 6 }),
  ];
  const undone = apply(game, "undo");
  assert.equal(undone.score, 2);
  assert.equal(undone.opponentScore, 3);
  assert.equal(undone.stats.touchdown, 0);
  assert.equal(undone.opponentStats?.touchdown, 0);
  assert.equal(undone.events.length, 0);
});
