import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) =>
  readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const editor = source("NativeCreateEventCardView.swift");
const dashboard = source("ContentView.swift");
const runtime = source("NativeOfflineRuntime.swift");

test("a protected local write finishes the editor before waiting for the API", () => {
  const save = editor.slice(editor.indexOf("private func saveEventCard"));
  const write = save.indexOf("try runtime.savePendingEventCard(change, subject: subject)");
  const handoff = save.indexOf("if let onSavedLocally", write);
  const fallback = save.indexOf('localSaveMessage = "Saved on this iPhone. Checking PIXL sync…"');
  assert.ok(write >= 0 && handoff > write && fallback > handoff);
  const localCompletion = save.slice(handoff, fallback);
  assert.match(localCompletion, /completedEventCallback = true\s+onSavedLocally\(\)/);
  assert.match(localCompletion, /Task \{\s+_ = await runtime\.retryPendingEventCards\(clerk: clerk, onlyID: draft\.id\)\s+\}/);
  assert.match(localCompletion, /return/);
  assert.doesNotMatch(localCompletion, /completeSync|onCreated\(/);
  assert.match(editor, /guard !completedEventCallback else \{ return \}/);
  // Failed protected writes do not close the editor or pretend they saved.
  assert.match(save, /if persistedLocally \{[\s\S]*?else \{\s+errorMessage = "This Event Card could not be saved on this iPhone/);
});

test("create, edit, and pending-card editors all return to the dashboard on local save", () => {
  const routes = dashboard.slice(
    dashboard.indexOf("private func heroDestinationView"),
    dashboard.indexOf("case .recordMoments:", dashboard.indexOf("private func heroDestinationView")),
  );
  assert.equal((routes.match(/NativeCreateEventCardView\(/g) ?? []).length, 3);
  assert.equal((routes.match(/onSavedLocally: \{ heroDestination = nil \}/g) ?? []).length, 3);
  assert.match(dashboard, /\.nativeEventCardQueueSynced\)\) \{ _ in\s+Task \{ await loadSchedule\(\) \}/);
});

test("pending cards are visible high on the dashboard even when schedule loading fails", () => {
  assert.equal((dashboard.match(/^\s+pendingEventCardSection$/gm) ?? []).length, 1);
  assert.match(dashboard, /\.accessibilityIdentifier\("dashboard-header-section"\)\s+pendingEventCardSection\s+athleteHero/);
  const section = dashboard.slice(
    dashboard.indexOf("private var pendingEventCardSection"),
    dashboard.indexOf("private func heroDestinationView"),
  );
  assert.match(section, /offlineRuntime\.pendingEventCards\(subject: subject\)/);
  assert.doesNotMatch(section, /case .*\.schedule|offlineRuntime\.online/);
  assert.match(section, /change\.draft\.time/);
  assert.match(section, /change\.draft\.timezone/);
  assert.match(section, /change\.draft\.location/);
  assert.match(section, /Button\("Edit Event Card"\)/);
  assert.match(section, /dashboard-pending-event-delete/);
});

test("sync retries preserve protected pending work when the server fails", () => {
  const retry = runtime.slice(
    runtime.indexOf("func retryPendingEventCards"),
    runtime.indexOf("private func syncPendingEventCard"),
  );
  assert.match(retry, /recordEventCardFailure\(id: change\.id, error: error, subject: subject\)/);
  assert.doesNotMatch(retry, /removePendingEventCard|discardPendingEventCard/);
  assert.match(runtime, /guard let subject, vault\.canContinue\(subject: subject\) else \{ return \[\] \}/);
  assert.match(runtime, /try vault\.write\(JSONEncoder\(\)\.encode\(change\), key: key\)/);
});
