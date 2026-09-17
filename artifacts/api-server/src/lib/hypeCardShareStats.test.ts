import assert from "node:assert/strict";
import test from "node:test";
import { computeHypeCardShareStats } from "./hypeCardShareStats";

test("aggregates only finalized games for the selected sport", () => {
  const updatedAt = new Date("2026-09-17T12:00:00.000Z");
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [
      { sport: "basketball", status: "final", score: 12, stats: { assist: 3, rebound: 4 } },
      { sport: "basketball", status: "live", score: 99, stats: { assist: 99 } },
      { sport: "soccer", status: "final", score: 2, stats: { goal: 2 } },
      { sport: "basketball", status: "final", score: 8, stats: { assist: 2, rebound: 1 } },
    ],
  }, "Jordan", "basketball", updatedAt);

  assert.deepEqual({ ...result?.stats }, { assist: 5, rebound: 5 });
  assert.equal(result?.gamesPlayed, 2);
  assert.equal(result?.score, 20);
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
      stats: { assist: 2.9, "Unsafe Key": 20, rebound: -3, block: Number.NaN },
    }],
  }, "Jordan", "basketball", new Date());

  assert.equal(result?.score, 0);
  assert.deepEqual({ ...result?.stats }, { assist: 2 });
});