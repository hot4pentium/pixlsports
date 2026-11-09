import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tracker = readFileSync(new URL("../PIXL Sports/NativeEventTrackerView.swift", import.meta.url), "utf8");
const tools = readFileSync(new URL("../PIXL Sports/NativeEventTools.swift", import.meta.url), "utf8");

test("live score controls remain present when local editing is temporarily blocked", () => {
  const scoreboard = tracker.slice(tracker.indexOf("private func scoreboard("), tracker.indexOf("private func adjustScore("));
  assert.match(scoreboard, /if showsControls \{/);
  assert.doesNotMatch(scoreboard, /if editable \{/);
  assert.match(scoreboard, /\.disabled\(!editable\)/);
  assert.match(scoreboard, /\.disabled\(score == 0\)/);
  for (const side of ["team", "opponent"]) {
    assert.match(scoreboard, new RegExp(`native-event-score-.*${side}`));
  }
  assert.equal((tracker.match(/showsControls: game\.status == "live"/g) ?? []).length, 2);
  assert.equal((tracker.match(/showsControls: false/g) ?? []).length, 2);
});

test("Prep recovery does not prevent locally saved tracker taps", () => {
  const editing = tools.slice(tools.indexOf("var canEditTrackerLocally:"), tools.indexOf("var canQueueStat:"));
  assert.match(editing, /!conflictBlocked \|\| hasPendingPrepCommand/);
  assert.match(editing, /!unreadablePendingData/);
  assert.match(editing, /trackerRecoveryStatus\?\.permitsLocalEntry/);
  assert.match(editing, /!eventIsFinal/);
  assert.match(editing, /ownsCurrentScope/);
  assert.doesNotMatch(editing, /!busy|offline\.online/);
  // Sending remains paused behind unresolved Prep; local tracker entry does not.
  assert.match(tools, /private func drainQueue[\s\S]*?guard !busy, !drainingQueue, !conflictBlocked/);
  const save = tools.slice(tools.indexOf("func save("), tools.indexOf("func retry("));
  assert.match(save, /if kind == "prep" \{\s*guard !conflictBlocked, canEditLocally/);
  assert.match(save, /try persistPendingQueue\(\)[\s\S]*?rebuildProjection\(\)[\s\S]*?await drainQueue/);
});
