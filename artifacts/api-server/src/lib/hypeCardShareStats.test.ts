import assert from "node:assert/strict";
import test from "node:test";
import { computeHypeCardShareStats } from "./hypeCardShareStats";

test("aggregates only finalized games for the selected sport", () => {
  const updatedAt = new Date("2026-09-17T12:00:00.000Z");
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [
      { sport: "basketball", status: "final", date: "2026-09-12", opponent: "Northside", score: 12, opponentScore: 8, stats: { assist: 3, rebound: 4 } },
      { sport: "basketball", status: "live", score: 99, stats: { assist: 99 } },
      { sport: "soccer", status: "final", score: 2, stats: { goal: 2 } },
      { sport: "basketball", status: "final", date: "2026-09-15", opponent: "Riverside", score: 8, opponentScore: 10, stats: { assist: 2, rebound: 1 } },
    ],
  }, "Jordan", "basketball", updatedAt);

  assert.deepEqual({ ...result?.stats }, { assist: 5, rebound: 5 });
  assert.equal(result?.gamesPlayed, 2);
  assert.equal(result?.score, 20);
  assert.deepEqual(result?.games?.map((game) => ({ ...game, stats: { ...game.stats } })), [
    {
      date: "2026-09-12",
      opponent: "Northside",
      score: 12,
      opponentScore: 8,
      stats: { assist: 3, rebound: 4 },
    },
    {
      date: "2026-09-15",
      opponent: "Riverside",
      score: 8,
      opponentScore: 10,
      stats: { assist: 2, rebound: 1 },
    },
  ]);
  assert.equal(result?.updatedAt, updatedAt);
});

test("rejects non-tracker payloads and unsafe stat values", () => {
  assert.equal(
    computeHypeCardShareStats({ tool: "hype-card", games: [] }, "Jordan", "basketball", new Date()),
    null,
  );

  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [{
      sport: "basketball",
      status: "final",
      score: -5,
      opponentScore: 11.8,
      date: "2026-09-18",
      opponent: "Northside",
      stats: { assist: 2.9, "Unsafe Key": 20, rebound: -3, block: Number.NaN },
    }],
  }, "Jordan", "basketball", new Date());

  assert.equal(result?.score, 0);
  assert.deepEqual(result?.games?.map((game) => ({ ...game, stats: { ...game.stats } })), [{
    date: "2026-09-18",
    opponent: "Northside",
    score: 0,
    opponentScore: 11,
    stats: { assist: 2 },
  }]);
  assert.deepEqual({ ...result?.stats }, { assist: 2 });
});