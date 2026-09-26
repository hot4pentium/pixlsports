import assert from "node:assert/strict";
import test from "node:test";
import { computeHypeCardShareStats } from "./hypeCardShareStats";

test("aggregates only finalized games for the selected sport", () => {
  const updatedAt = new Date("2026-09-17T12:00:00.000Z");
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [
      {
        sport: "basketball",
        status: "final",
        date: "2026-09-12",
        opponent: "Northside",
        score: 12,
        opponentScore: 8,
        stats: { assist: 3, rebound: 4 },
        events: [
          { id: "private-athlete-event", statId: "assist", attribution: "athlete", createdAt: "private-time" },
          { id: "private-team-event", statId: "assist", attribution: "team", createdAt: "private-time" },
          { id: "private-rebound-event", statId: "rebound", attribution: "athlete", notes: "private note" },
          { id: "unsafe-event", statId: "Unsafe Key", attribution: "athlete" },
        ],
      },
      { sport: "basketball", status: "live", score: 99, stats: { assist: 99 } },
      { sport: "soccer", status: "final", score: 2, stats: { goal: 2 } },
      {
        sport: "basketball",
        status: "final",
        date: "2026-09-15",
        opponent: "Riverside",
        score: 8,
        opponentScore: 10,
        stats: { assist: 2, rebound: 1 },
        events: [
          { id: "private-second-game-event", statId: "assist", attribution: "athlete" },
          { id: "team-only-event", statId: "rebound", attribution: "team" },
        ],
      },
    ],
  }, "Jordan", "basketball", updatedAt);

  assert.deepEqual({ ...result?.stats }, { assist: 5, rebound: 5 });
  assert.equal(result?.gamesPlayed, 2);
  assert.equal(result?.score, 20);
  assert.deepEqual(result?.record, { wins: 1, losses: 1, ties: 0, gamesPlayed: 2 });
  assert.deepEqual(result?.games?.map((game) => ({
    ...game,
    stats: { ...game.stats },
    athleteStats: { ...game.athleteStats },
  })), [
    {
      date: "2026-09-12",
      opponent: "Northside",
      score: 12,
      opponentScore: 8,
      scoreRecorded: true,
      stats: { assist: 3, rebound: 4 },
      athleteStats: { assist: 1, rebound: 1 },
    },
    {
      date: "2026-09-15",
      opponent: "Riverside",
      score: 8,
      opponentScore: 10,
      scoreRecorded: true,
      stats: { assist: 2, rebound: 1 },
      athleteStats: { assist: 1 },
    },
  ]);
  assert.deepEqual(Object.keys(result?.games[0] ?? {}).sort(), [
    "athleteStats",
    "date",
    "opponent",
    "opponentScore",
    "score",
    "scoreRecorded",
    "stats",
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
      events: [
        { statId: "assist", attribution: "athlete" },
        { statId: "Unsafe Key", attribution: "athlete" },
        { statId: "rebound", attribution: "team" },
      ],
    }],
  }, "Jordan", "basketball", new Date());

  assert.equal(result?.score, 0);
  assert.deepEqual(result?.record, { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 });
  assert.deepEqual(result?.games?.map((game) => ({
    ...game,
    stats: { ...game.stats },
    athleteStats: { ...game.athleteStats },
  })), [{
    date: "2026-09-18",
    opponent: "Northside",
    score: 0,
    opponentScore: 11,
      scoreRecorded: false,
    stats: { assist: 2 },
    athleteStats: { assist: 1 },
  }]);
  assert.deepEqual({ ...result?.stats }, { assist: 2 });
});

test("counts an explicitly recorded 0–0 tie but excludes an unentered 0–0 score", () => {
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [
      {
        sport: "basketball",
        status: "final",
        score: 0,
        opponentScore: 0,
        scoreRecorded: true,
        stats: {},
        events: [],
      },
      {
        sport: "basketball",
        status: "final",
        score: 0,
        opponentScore: 0,
        scoreRecorded: false,
        stats: {},
        events: [],
      },
    ],
  }, "Jordan", "basketball", new Date());

  assert.deepEqual(result?.record, { wins: 0, losses: 0, ties: 1, gamesPlayed: 1 });
  assert.deepEqual(result?.games.map((game) => game.scoreRecorded), [true, false]);
});