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

test("the event tab stays clickable for Record Moments without forced navigation", () => {
  assert.match(bar, /\.disabled\(!isGame\)/);
  assert.doesNotMatch(bar, /\.disabled\([^)]*(isComplete|trackingAccess)/);
  assert.match(bar, /guard isGame else \{ return \}/);
  assert.match(detail, /guard step != \.trackStats \|\| event\.type == "game"/);
  assert.match(detail, /selected: effectiveSelectedStep/);
  assert.doesNotMatch(detail, /if complete && selectedStep == \.trackStats/);
  assert.match(detail, /onCompletionChange: \{ workspaceGameCompleted = \$0 \}/);
});

test("completion blocks timed tools but keeps recording and save recovery", () => {
  assert.match(tracking, /private func selectMode[\s\S]*?guard isActive, chooserAvailable, modeAllowed\(mode\)/);
  assert.match(tracking, /mode == \.recordMoments \|\| \(trackingAllowed && !gameIsComplete/);
  assert.match(tracking, /\.disabled\(gameIsComplete \|\| !trackingAllowed \|\| clerk == nil\)/);
  assert.match(tracking, /eventToolVisibility\(trackingAllowed && !gameIsComplete && selectedMode == \.statTracker\)/);
  assert.match(tracking, /onChange\(of: gameIsComplete\)[\s\S]*?closeUnavailableTrackingMode\(\)/);
  const availabilityChanges = tracking.slice(tracking.indexOf(".onChange(of: gameIsComplete"), tracking.indexOf("private var modePickerSheet"));
  assert.doesNotMatch(availabilityChanges, /showingRecordMoments = false|recordMomentsAfterPicker = false/);
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
