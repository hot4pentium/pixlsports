import assert from "node:assert/strict";
import test from "node:test";
import {
  gameIdsFromAthleteEventShares,
  mapAthleteEventSummaries,
  type AthleteEventShareRow,
} from "./athleteEventSummaries";

const shares: AthleteEventShareRow[] = [
  {
    id: "game-share",
    title: "Tigers vs Bears",
    events: [{ id: "game-1", date: "2099-04-01", time: "18:00", type: "game", opponent: "Bears", location: "Field 2" }],
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
  });
  assert.equal(events[1]?.status, "upcoming");
  assert.equal(JSON.stringify(events).includes("private tracker data"), false);
});
