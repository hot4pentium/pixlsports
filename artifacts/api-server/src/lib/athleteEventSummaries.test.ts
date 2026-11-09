import assert from "node:assert/strict";
import test from "node:test";
import {
  gameIdsFromAthleteEventShares,
  mapAthleteEventSummaries,
  type AthleteEventShareRow,
} from "./athleteEventSummaries";
import { scheduledEventStart } from "./timezone";

const shares: AthleteEventShareRow[] = [
  {
    id: "game-share",
    title: "Tigers vs Bears",
    events: [{ id: "game-1", date: "2099-04-01", time: "18:00", type: "game", opponent: "Bears", location: "Field 2", timezone: "America/Chicago", notes: "private prep", snacks: "private snacks" }],
  },
  {
    id: "practice-share",
    title: "Team practice",
    events: [{ id: "practice-1", date: "2099-04-03", time: "", type: "practice" }],
  },
  {
    id: "invalid-date",
    title: "Invalid date",
    events: [{ id: "game-2", date: "2099-02-30", type: "game" }],
  },
  {
    id: "multiple-events",
    title: "Not an Event Card",
    events: [
      { id: "game-3", date: "2099-04-04", type: "game" },
      { id: "game-4", date: "2099-04-05", type: "game" },
    ],
  },
];

test("only valid single-event cards contribute game tracker lookups", () => {
  assert.deepEqual(gameIdsFromAthleteEventShares(shares), ["game-1"]);
});

test("event summaries retain safe schedule details and tracker final status", () => {
  const events = mapAthleteEventSummaries(shares, [
    { gameId: "game-1", game: { status: "final", score: "private tracker data" } },
  ]);

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    shareToken: "game-share",
    eventId: "game-1",
    title: "Tigers vs Bears",
    date: "2099-04-01",
    time: "18:00",
    type: "game",
    status: "final",
    opponent: "Bears",
    location: "Field 2",
    timezone: "America/Chicago",
  });
  assert.equal(events[1]?.status, "upcoming");
  assert.equal(JSON.stringify(events).includes("private tracker data"), false);
  assert.equal(JSON.stringify(events).includes("private prep"), false);
  assert.equal(JSON.stringify(events).includes("private snacks"), false);
});

test("event summaries omit invalid event time zones", () => {
  const events = mapAthleteEventSummaries([{
    id: "invalid-timezone",
    title: "Tigers vs Bears",
    events: [{ id: "game-2", date: "2099-04-01", time: "18:00", type: "game", timezone: "not/a-timezone" }],
  }], []);

  assert.equal(events[0]?.timezone, undefined);
});

const timedShare = (overrides: Record<string, unknown> = {}): AthleteEventShareRow => ({
  id: "timed-card", title: "Tigers game",
  events: [{
    id: "timed-game", type: "game", status: "live", date: "2026-11-08",
    time: "21:05", timezone: "America/New_York", ...overrides,
  }],
});

test("a yesterday card cannot remain live from an old calendar or tracker status", () => {
  const share = timedShare();
  const tracker = { gameId: "timed-game", game: { status: "live", score: 7 } };
  const before = JSON.stringify({ share, tracker });
  const events = mapAthleteEventSummaries([share], [tracker], { now: new Date("2026-11-09T18:00:00Z") });
  assert.equal(events[0]?.status, "final");
  assert.equal(JSON.stringify({ share, tracker }), before, "display normalization must not finalize stats");
});

test("shared game display matches owner kickoff and one-hour Share/Complete boundary", () => {
  const status = (now: string) =>
    mapAthleteEventSummaries([timedShare()], [], { now: new Date(now) })[0]?.status;
  assert.equal(status("2026-11-09T01:55:00Z"), "upcoming");
  assert.equal(status("2026-11-09T02:04:59Z"), "upcoming");
  assert.equal(status("2026-11-09T02:05:00Z"), "live");
  assert.equal(status("2026-11-09T03:04:59Z"), "live");
  assert.equal(status("2026-11-09T03:05:00Z"), "final");
});

test("explicit final results remain final even before their scheduled time", () => {
  const now = new Date("2026-11-08T18:00:00Z");
  assert.equal(mapAthleteEventSummaries([timedShare({ status: "final" })], [], { now })[0]?.status, "final");
  assert.equal(mapAthleteEventSummaries([timedShare()], [
    { gameId: "timed-game", game: { status: "final" } },
  ], { now })[0]?.status, "final");
});

test("practice display uses its own three-hour window", () => {
  const practice = timedShare({ type: "practice" });
  assert.equal(mapAthleteEventSummaries([practice], [], { now: new Date("2026-11-09T05:04:59Z") })[0]?.status, "live");
  assert.equal(mapAthleteEventSummaries([practice], [], { now: new Date("2026-11-09T05:05:00Z") })[0]?.status, "final");
});

test("event zone overrides invite fallback and midnight does not end a new game", () => {
  const options = { now: new Date("2026-11-09T05:15:00Z"), timezone: "UTC" };
  assert.equal(mapAthleteEventSummaries([timedShare({ time: "23:45" })], [], options)[0]?.status, "live");
  assert.equal(mapAthleteEventSummaries([timedShare({ timezone: undefined, time: "23:45" })], [],
    { ...options, timezone: "America/New_York" })[0]?.status, "live");
});

test("legacy missing-time cards eventually stop displaying live", () => {
  assert.equal(mapAthleteEventSummaries([timedShare({ time: "", timezone: undefined })], [],
    { now: new Date("2026-11-11T00:00:00Z") })[0]?.status, "final");
});

test("private tool schedules can retain the actual tracker lifecycle", () => {
  const events = mapAthleteEventSummaries([timedShare()], [
    { gameId: "timed-game", game: { status: "live" } },
  ], { now: new Date("2026-11-09T18:00:00Z"), normalizeDisplayStatus: false });
  assert.equal(events[0]?.status, "live", "a calendar Complete label must not finalize a private game");
});

test("scheduled starts accept AM/PM and resolve DST gaps and repeats deterministically", () => {
  assert.equal(scheduledEventStart("2026-11-08", "9:05 PM", "America/New_York")?.toISOString(), "2026-11-09T02:05:00.000Z");
  assert.equal(scheduledEventStart("2026-11-01", "01:30", "America/New_York")?.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(scheduledEventStart("2026-03-08", "02:30", "America/New_York")?.toISOString(), "2026-03-08T07:30:00.000Z");
  assert.equal(scheduledEventStart("2026-02-30", "12:30", "UTC"), null);
  assert.equal(scheduledEventStart("2026-11-08", "25:00", "UTC"), null);
  assert.equal(scheduledEventStart("2026-11-08", "13:00 PM", "UTC"), null);
  assert.equal(scheduledEventStart("2026-11-08", "12:00", "Invalid/Zone"), null);
});
