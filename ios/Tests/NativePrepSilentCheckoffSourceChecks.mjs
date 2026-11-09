import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}.swift`, import.meta.url), "utf8");
const prep = read("NativeEventPrepView");
const panel = read("NativeEventToolPanel");
const detail = read("SupporterEventDetailView");
const model = read("NativeEventTools");

test("the containing Event Details screen never inserts a Prep dirty-state banner", () => {
  assert.doesNotMatch(detail, /Prep has unsaved edits/);
  assert.match(detail, /onDirtyChange: \{ prepHasUnsavedChanges = \$0 \}/);
  assert.match(detail, /guard !prepHasUnsavedChanges else/);
  assert.match(prep, /\.onChange\(of: hasManualUnsavedEdits\)/);
  assert.match(prep, /\.navigationBarBackButtonHidden\(hasManualUnsavedEdits\)/);
  const manual = prep.slice(prep.indexOf("private var hasManualUnsavedEdits:"), prep.indexOf("private var readinessSummary:"));
  assert.match(manual, /notesDirty \|\| hasUnsavedTaskEntry \|\| draftWriteFailed/);
  assert.doesNotMatch(manual, /pendingCount|busy|\bedited\b/);
});

test("Prep-only pending commands cannot open the parent tracker-save panel", () => {
  assert.match(model, /var hasPendingTrackerCommand: Bool \{ pendingQueue\.contains \{ \$0\.command\.kind != "prep" \} \}/);
  assert.match(panel, /if showsTrackerRecovery, let clerk/);
  const visibility = panel.slice(panel.indexOf("private var showsTrackerRecovery:"), panel.indexOf("private var toolAccent:"));
  assert.match(visibility, /selected != \.prep/);
  assert.match(visibility, /isComplete/);
  assert.match(visibility, /!trackingAllowed && workspaceModel\.hasPendingTrackerCommand/);
  assert.doesNotMatch(visibility, /pendingCount/);
  assert.match(panel, /if workspaceModel\.pendingFinal/);
  assert.match(panel, /NativeToolSaveNotice\(model: workspaceModel, clerk: clerk, savedContentName: "Stat Tracker"\)/);
});

test("routine saves and restored queues remain silent without clearing durable data", () => {
  assert.doesNotMatch(prep, /saveFooter|saveStatusText|Prep saved/);
  assert.equal((prep.match(/savedContentName: "Prep", showsRoutineActivity: false/g) ?? []).length, 2);
  const restore = model.slice(model.indexOf("init(shareToken:"), model.indexOf("private static func openQueue"));
  assert.doesNotMatch(restore, /Checking your saved tracker changes/);
  assert.match(restore, /errorMessage = durableQueue\.storageError\?\.localizedDescription/);
  assert.match(prep, /guard persistDraft\(\) else \{ return \}/);
  assert.match(prep, /try NativeOfflineVault\.shared\.write\(data, key: "draft\/" \+ event\.shareToken\)/);
  assert.match(prep, /draftWriteFailed = true/);
  assert.match(prep, /\.onChange\(of: scenePhase\)[\s\S]*?await savePrepChanges\(includeNotes: false\)/);
});

test("the final checkoff does not collapse the tapped row or insert a celebration section", () => {
  const toggle = prep.slice(prep.indexOf("private func toggleItem("), prep.indexOf("private func applySavedPrep("));
  assert.match(toggle, /items\[index\]\.completed\.toggle\(\)/);
  assert.match(toggle, /scheduleChecklistAutosave\(\)/);
  assert.doesNotMatch(toggle, /isChecklistExpanded =|withAnimation/);
  assert.match(toggle, /showCompletionCelebration = true/);
  const ring = prep.slice(prep.indexOf("private func readinessHeader("), prep.indexOf("private var canSave:"));
  assert.match(ring, /if showCompletionCelebration \{ completionCelebration \}/);
  assert.match(ring, /\.frame\(width: compact \? 46 : 58, height: compact \? 46 : 58\)/);
  assert.equal((prep.match(/if showCompletionCelebration \{/g) ?? []).length, 1);
});

test("native regressions measure full-container geometry during authenticated delayed saves", () => {
  const tests = readFileSync(new URL("../UITests/SupporterEventDetailUITests.swift", import.meta.url), "utf8");
  assert.match(tests, /testPrepCheckoffsKeepRowsStationaryInFullEventDetails/);
  assert.match(tests, /PIXL_PREP_EARLY_TEST_EVENT_ID/);
  assert.match(tests, /PIXL_PREP_AVAILABLE_TEST_EVENT_ID/);
  assert.match(tests, /row\.frame\.minY, original\.minY, accuracy: 1\.5/);
  assert.match(tests, /hero\.frame\.minY, heroY, accuracy: 1\.5/);
  assert.match(tests, /--ui-testing-delay-prep-save/);
  assert.match(tests, /testSignedInQuickPrepLostResponseRetriesSameMutationAfterRelaunch/);
});
