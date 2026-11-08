import assert from "node:assert/strict";
import test from "node:test";
import { nativeSeasonGames } from "./nativeSeasonStats";

const game = (id: string, extra: Record<string, unknown> = {}) => ({
  id, sport: "soccer", status: "final", date: "2026-11-08", opponent: "Bears",
  score: 0, opponentScore: 0, scoreRecorded: false, stats: { goal: 3, save: 2 },
  events: [{ statId: "goal", attribution: "athlete" }, { statId: "goal", attribution: "team" }],
  ...extra,
});
const history = (...games: unknown[]) => ({ tool: "stat-tracker", games });

test("private history retains IDs and separates athlete totals from team totals", () => {
  const [result] = nativeSeasonGames(history(game("one")), "soccer");
  assert.equal(result?.id, "one");
  assert.equal(result?.athleteStats.goal, 1);
  assert.equal(result?.stats.goal, 3);
  assert.equal(result?.scoreRecorded, false, "An unentered score is not a 0–0 result.");
  assert.equal(Object.hasOwn(result!, "events"), false);
});

test("same-day games remain distinct and repeated IDs do not double count", () => {
  const results = nativeSeasonGames(history(game("one"), game("two"), game("one")), "soccer");
  assert.deepEqual(results.map(({ id }) => id), ["one", "two"]);
});

test("unfinished, other-sport, practice and cheer-only games are excluded", () => {
  assert.deepEqual(nativeSeasonGames(history(
    game("live", { status: "live" }), game("other", { sport: "basketball" }),
    game("practice", { type: "practice" }), game("cheers", { liveTapsOnly: true }),
  ), "soccer"), []);
  assert.deepEqual(nativeSeasonGames({ tool: "other", games: [game("one")] }, "soccer"), []);
});

test("valid owner final corrections supersede recorded athlete plays", () => {
  const [result] = nativeSeasonGames(history(game("one", {
    finalCorrection: { correctedAt: "2026-11-08T12:00:00Z", athleteStats: { goal: 2 } },
  })), "soccer");
  assert.equal(result?.athleteStats.goal, 2);
});

test("football athlete yardage sums yards and excludes opponent possession", () => {
  const [result] = nativeSeasonGames(history(game("football", {
    sport: "football", stats: { "pass-yard": 25, tackle: 1 },
    events: [
      { statId: "pass-yard", attribution: "athlete", yards: 15 },
      { statId: "pass-yard", attribution: "athlete", yards: 10 },
      { statId: "tackle", attribution: "athlete", possessionSide: "opponent" },
    ],
  })), "football");
  assert.equal(result?.athleteStats["pass-yard"], 25);
  assert.equal(result?.athleteStats.tackle, undefined);
});

test("history is date ordered, with no public or device-media identifiers", () => {
  const results = nativeSeasonGames(history(
    game("later", { date: "2026-11-09", publicToken: "private", filename: "phone.mov" }),
    game("earlier", { date: "2026-11-01" }),
  ), "soccer");
  assert.deepEqual(results.map(({ id }) => id), ["earlier", "later"]);
  assert.equal(JSON.stringify(results).includes("private"), false);
  assert.equal(JSON.stringify(results).includes("phone.mov"), false);
});
