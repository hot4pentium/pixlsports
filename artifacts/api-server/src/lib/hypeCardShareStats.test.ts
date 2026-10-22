import assert from "node:assert/strict";
import test from "node:test";
import { computeHypeCardShareStats } from "./hypeCardShareStats";

test("soccer tracking stats remain available in corrected public athlete stats", () => {
  const athleteStats = { pass: 1, header: 1, clearance: 1, "corner-kick": 1, "penalty-kick": 1, "red-card": 1 };
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [{
      sport: "soccer", status: "final", date: "2026-10-22",
      score: 0, opponentScore: 0, stats: athleteStats, events: [],
      finalCorrection: { athleteStats, correctedAt: "2026-10-22T12:00:00.000Z" },
    }],
  }, "Jordan", "soccer", new Date("2026-10-22T13:00:00.000Z"));
  for (const id of Object.keys(athleteStats)) assert.equal(result?.games[0]?.athleteStats[id], 1);
});

test("a fresh Hype Card stats read reflects corrected finalized score and athlete totals", () => {
  const original = {
    tool: "stat-tracker",
    games: [{
      sport: "soccer",
      status: "final",
      date: "2026-09-12",
      opponent: "Northside",
      score: 1,
      opponentScore: 2,
      stats: { goal: 1 },
      events: [{ statId: "goal", attribution: "athlete" }],
    }],
  };
  const before = computeHypeCardShareStats(original, "Jordan", "soccer", new Date("2026-09-12T12:00:00Z"));
  const corrected = {
    ...original,
    games: [{
      ...original.games[0],
      score: 3,
      stats: { goal: 2 },
      events: [
        { statId: "goal", attribution: "athlete" },
        { statId: "goal", attribution: "athlete" },
      ],
    }],
  };
  const after = computeHypeCardShareStats(corrected, "Jordan", "soccer", new Date("2026-09-15T12:00:00Z"));

  assert.equal(before?.score, 1);
  assert.equal(after?.score, 3);
  assert.equal(after?.games[0]?.score, 3);
  assert.equal(after?.stats.goal, 2);
  assert.equal(after?.games[0]?.athleteStats.goal, 2);
  assert.equal(after?.record.wins, 1);
  assert.equal(before?.record.losses, 1);
  assert.notEqual(before?.updatedAt, after?.updatedAt);
});

test("public projection uses validated final-correction score, tally, and athlete totals without exposing metadata", () => {
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [{
      sport: "soccer",
      status: "final",
      date: "2026-09-12",
      opponent: "Northside",
      score: 4,
      opponentScore: 2,
      scoreRecorded: true,
      outcome: "win",
      stats: { goal: 3, assist: 2 },
      events: [
        { statId: "goal", attribution: "team" },
        { statId: "assist", attribution: "athlete" },
      ],
      finalCorrection: {
        athleteStats: { goal: 2, assist: 1 },
        correctedAt: "2026-09-15T12:00:00.000Z",
      },
    }],
  }, "Jordan", "soccer", new Date("2026-09-15T12:00:00Z"));

  assert.equal(result?.score, 4);
  assert.deepEqual(result?.record, { wins: 1, losses: 0, ties: 0, gamesPlayed: 1 });
  assert.deepEqual({ ...result?.stats }, { goal: 3, assist: 2 });
  assert.deepEqual({ ...result?.games[0]?.athleteStats }, { goal: 2, assist: 1 });
  assert.deepEqual(Object.keys(result?.games[0] ?? {}).sort(), [
    "athleteStats", "date", "opponent", "opponentScore", "score", "scoreRecorded", "stats",
  ]);
});

test("invalid correction metadata does not replace event-derived public athlete totals", () => {
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [{
      sport: "soccer",
      status: "final",
      score: 1,
      opponentScore: 0,
      stats: { goal: 1 },
      events: [{ statId: "goal", attribution: "athlete" }],
      finalCorrection: {
        athleteStats: { goal: 2 },
        correctedAt: "2026-09-15T12:00:00.000Z",
      },
    }],
  }, "Jordan", "soccer", new Date());
  assert.equal(result?.games[0]?.athleteStats.goal, 1);
});

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

test("counts manually marked results without inventing a final score", () => {
  const result = computeHypeCardShareStats({
    tool: "stat-tracker",
    games: [{
      sport: "basketball",
      status: "final",
      score: 0,
      opponentScore: 0,
      scoreRecorded: false,
      outcome: "win",
      stats: {},
      events: [],
    }],
  }, "Jordan", "basketball", new Date());

  assert.deepEqual(result?.record, { wins: 1, losses: 0, ties: 0, gamesPlayed: 1 });
  assert.equal(result?.games[0].scoreRecorded, false);
});