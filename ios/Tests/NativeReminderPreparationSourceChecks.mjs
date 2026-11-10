import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) =>
  readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const runtime = source("NativeOfflineRuntime.swift");
const coordinator = source("NativeLocalEventReminderCoordinator.swift");
const push = source("NativePushRegistrationCoordinator.swift");
const slice = (start, end) => runtime.slice(runtime.indexOf(start), runtime.indexOf(end, runtime.indexOf(start)));

test("successful Event Card sync requests fresh preparation, including when a worker is busy", () => {
  const retry = slice("func retryPendingEventCards(", "private func syncPendingEventCard(");
  assert.match(retry, /if didSyncAny \{[\s\S]*?resume\(clerk: clerk, force: true\)/);
  const resume = slice("func resume(", "private func verifiedSchedule(");
  assert.match(resume, /guard worker == nil else \{[\s\S]*?if force \{ preparationRefreshRequested = true \}/);
  assert.match(resume, /if workerID == jobID \{[\s\S]*?worker = nil[\s\S]*?if preparationRefreshRequested \{[\s\S]*?preparationRefreshRequested = false[\s\S]*?resume\(clerk: clerk, force: true\)/);
  assert.match(slice("private func cancelWorker()", "func resume("), /preparationRefreshRequested = false/);
});

test("preparation uses a new verified schedule after syncing Event Cards", () => {
  const resume = slice("func resume(", "private func verifiedSchedule(");
  const synced = resume.indexOf("let syncedCards = await retryPendingEventCards");
  const fresh = resume.indexOf("preparationPage = try await verifiedSchedule", synced);
  const prepare = resume.indexOf("await prepare(preparationPage", fresh);
  assert.ok(synced >= 0 && fresh > synced && prepare > fresh);
  assert.match(resume.slice(fresh, prepare), /vault\.namespace == scope/);
  assert.match(resume.slice(fresh, prepare), /vault\.canContinue\(subject: clerk\.user\?\.id\)/);
});

test("a failed event download does not skip remaining downloads or final reminder reconciliation", () => {
  const prepare = runtime.slice(runtime.indexOf("private func prepare("));
  const failure = prepare.indexOf("failed += 1");
  const next = prepare.indexOf("continue", failure);
  const reconcile = prepare.indexOf("await NativeLocalEventReminderCoordinator.shared.reconcile()", next);
  assert.ok(failure >= 0 && next > failure && reconcile > next);
  assert.doesNotMatch(prepare.slice(failure, next), /\breturn\b/);
  assert.match(prepare, /vault\.skipsAutomaticDownload\(event\.shareToken\)/);
  assert.match(prepare, /Tap Retry to finish missing downloads/);
});

test("settings distinguish an actual future reminder from toggles alone and show a 12-hour next time", () => {
  assert.match(coordinator, /if let next = reminders\.first/);
  assert.match(coordinator, /formatter\.dateFormat = "EEE, MMM d 'at' h:mm a"/);
  assert.match(coordinator, /formatter\.string\(from: next\.fire\)/);
  assert.match(coordinator, /No future reminders are currently saved on this iPhone/);
});

test("preparation fixes preserve verified downloads and acknowledged single-channel delivery", () => {
  assert.match(coordinator, /prepared\.contains\(\$0\.shareToken\)/);
  assert.match(coordinator, /vault\.read\("workspace\/" \+ \$0\.shareToken\)/);
  assert.match(coordinator, /schedule\.linkId == lease\.linkId/);
  assert.match(coordinator, /notBefore: Date\(\)\.addingTimeInterval\(120\)/);
  assert.match(coordinator, /consumedIDs: Set\(saved\.consumed\.keys\)/);
  const disable = push.indexOf("guard await disable(clerk: clerk)");
  const activate = push.indexOf("try await local.activate", disable);
  assert.ok(disable >= 0 && activate > disable);
});
