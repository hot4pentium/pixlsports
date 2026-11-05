import assert from "node:assert/strict";
import test from "node:test";
import { liveTapGameRef, visibleLiveTapReceipt } from "./liveTapGameRef";
import { visibleLiveTapSummary } from "./athleteLiveTaps";

test("hidden completions and recovered receipts conceal a game ID equal to its Event Card ID", () => {
  const eventId = "bb8d0448-a03c-4484-bf71-8ecbb834a778";
  const inviteId = "b8193e41-a972-4a6b-869b-f83e443a5c29";
  const gameRef = liveTapGameRef(inviteId, eventId);
  const completion = {
    id: "03698112-0232-4988-94d2-289807465197", gameId: eventId, gameRef,
    eventId, athleteName: "Athlete", eventTitle: "Nov 3 vs Opponent",
    sport: "soccer", seasonId: null, endedAt: "2026-11-03T23:00:00.000Z", cheers: [],
  };
  const source = {
    active: false, gameId: eventId, gameRef, cheers: [], seasonCheers: [],
    archivedSeasons: [], completedSessions: [completion],
  };
  const hidden = visibleLiveTapSummary(source, false, inviteId);
  const receipt = visibleLiveTapReceipt({ id: "mutation", gameId: eventId, cheerKey: "goal" }, false, inviteId);
  const encoded = JSON.stringify({ ...hidden, receipt });
  assert.equal(encoded.includes(eventId), false, "no raw ID in completion, inactive summary, or receipt");
  assert.equal(encoded.includes("Opponent"), false);
  assert.equal(encoded.includes("2026-11-03"), false);
  assert.equal(hidden.completedSessions[0].gameId, receipt.gameId);
  assert.equal(receipt.gameRef, gameRef);
  assert.deepEqual(visibleLiveTapSummary(source, true, inviteId).completedSessions, [completion]);
  assert.equal(visibleLiveTapReceipt({ id: "mutation", gameId: eventId, cheerKey: "goal" }, true, inviteId).gameId, eventId);
  assert.equal(liveTapGameRef(inviteId, eventId), gameRef, "stable across replay");
  assert.notEqual(liveTapGameRef("another-invite", eventId), gameRef, "cannot correlate invites");
});
