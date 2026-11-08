import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const step = read("NativeEventDetailStep.swift");
const detail = read("SupporterEventDetailView.swift");
const bar = read("NativeEventStepBar.swift");
const panel = read("NativeEventToolPanel.swift");
const tracking = read("NativeEventTrackingPanel.swift");
const model = read("NativeEventTools.swift");
const hero = read("NativeHomeHeroCards.swift");

// Structural checks, not an Apple compiler or a rendered SwiftUI test.
test("completion uses explicit final states and the durable offline finish", () => {
  assert.match(step, /if isGame && isComplete \{ return \.share \}/);
  assert.match(step, /pendingFinal \|\| \[eventStatus, workspaceStatus, gameStatus\]/);
  assert.match(step, /\["final", "complete", "completed"\]/);
  const policy = step.slice(step.indexOf("static func gameIsComplete"), step.indexOf("func permittedSelection"));
  assert.doesNotMatch(policy, /Date\(|timeIntervalSince|elapsed/);
  assert.match(model, /var trackerIsComplete:[\s\S]*?trackerRecoveryStatus == \.gameFinished[\s\S]*?workspaceStatus: workspace\?\.eventStatus,[\s\S]*?gameStatus: displayedGame\?\.status,[\s\S]*?pendingFinal: pendingFinal/);
});

test("the event tab is visibly and accessibly disabled, with guarded selection", () => {
  assert.match(bar, /\.disabled\(!isGame \|\| isComplete \|\| !trackingAccess\.isAllowed\)/);
  assert.match(bar, /\.opacity\(isComplete \|\| !trackingAccess\.isAllowed \? 0\.45 : 1\)/);
  assert.match(bar, /This game is complete\. Use Share/);
  assert.match(bar, /guard isGame, !isComplete, trackingAccess\.isAllowed else \{ return \}/);
  assert.match(detail, /guard step != \.trackStats \|\| trackingAccess\(schedule: schedule, event: event, date: Date\(\)\)\.isAllowed/);
  assert.match(detail, /selected: effectiveSelectedStep/);
  assert.match(detail, /onChange\(of: gameIsComplete\)[\s\S]*?selectedStep = \.share/);
  assert.match(detail, /onCompletionChange: \{ workspaceGameCompleted = \$0 \}/);
});

test("completion blocks chooser and full tracker while preserving save recovery", () => {
  assert.match(tracking, /guard isActive, trackingAllowed, !gameIsComplete else \{ return \}/);
  assert.match(tracking, /private func selectMode[\s\S]*?guard isActive, trackingAllowed, !gameIsComplete/);
  assert.match(tracking, /\.disabled\(gameIsComplete \|\| !trackingAllowed\)[\s\S]*?native-event-full-tracker/);
  assert.match(tracking, /eventToolVisibility\(trackingAllowed && !gameIsComplete && selectedMode == \.statTracker\)/);
  assert.match(tracking, /onChange\(of: gameIsComplete\)[\s\S]*?showingModePicker = false/);
  assert.match(read("NativeEventTrackerView.swift"), /onChange\(of: model\.trackerIsComplete\)[\s\S]*?if !embedded \{ dismiss\(\) \}/);
  assert.match(panel, /onChange\(of: isComplete, initial: true\)[\s\S]*?onCompletionChange\(complete\)/);
  assert.match(panel, /if workspaceModel\.pendingFinal[\s\S]*?native-event-final-pending/);
  assert.match(panel, /NativeToolSaveNotice\(model: workspaceModel, clerk: clerk, savedContentName: "Stat Tracker"\)/);
  assert.doesNotMatch(panel + tracking + detail, /pendingQueue\s*=\s*\[\]|clearPending|removePending/);
});

test("already-active Live Taps retain their controls through Share without reopening the chooser", () => {
  assert.match(panel, /\(isComplete \|\| !trackingAllowed\) && selected == \.share && event\.liveTapsActive/);
  assert.match(tracking, /if !gameIsComplete && trackingAllowed \{ switchToolButton \}/);
  assert.match(tracking, /hasVisitedLiveTaps \|\| \(\(gameIsComplete \|\| !trackingAllowed\) && event\.liveTapsActive\)/);
  assert.match(tracking, /isActive: isActive && \(selectedMode == \.liveTaps \|\| gameIsComplete \|\| !trackingAllowed\)/);
});

test("Message Board details center in flexible space with a protected bottom footer", () => {
  assert.match(hero, /eventDetails\s*\.frame\(maxWidth: \.infinity, maxHeight: \.infinity, alignment: \.leading\)/);
  assert.match(hero, /nextStepFooter\s*\.padding\(\.top, 14\)\s*\.fixedSize\(horizontal: false, vertical: true\)/);
  const details = hero.slice(hero.indexOf("private var eventDetails"), hero.indexOf("private var nextStepFooter"));
  assert.match(details, /VStack\(alignment: \.leading/);
  assert.match(details, /dynamicTypeSize\.isAccessibilitySize \? nil : 2/);
  assert.match(details, /\.fixedSize\(horizontal: false, vertical: true\)/);
  assert.doesNotMatch(details, /\.frame\(height:|GeometryReader|offset\(y:/);
  assert.match(hero, /minHeight: 260/);
  assert.match(hero, /Button\(action: onOpenFanBase\)/);
  assert.match(hero, /Button\(action: onOpenHypeCard\)/);
});
