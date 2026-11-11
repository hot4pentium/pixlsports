import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) =>
  readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const runtime = source("NativeOfflineRuntime.swift");
const coordinator = source("NativeLocalEventReminderCoordinator.swift");
const push = source("NativePushRegistrationCoordinator.swift");
const flow = source("NativeEventPreparationFlow.swift");
const live = source("NativeEventReminderLiveDependencies.swift");
const slice = (start, end) => runtime.slice(runtime.indexOf(start), runtime.indexOf(end, runtime.indexOf(start)));

test("successful Event Card sync requests fresh preparation, including when a worker is busy", () => {
  const retry = slice("func retryPendingEventCards(", "private func syncPendingEventCard(");
  assert.match(retry, /if didSyncAny \{[\s\S]*?resume\(clerk: clerk, force: true\)/);
  const resume = slice("func resume(", "private func verifiedSchedule(");
  assert.match(resume, /worker\.request\(force: force\)/);
  assert.match(flow, /guard task == nil else \{[\s\S]*?if force \{ pending = operation \}/);
  assert.match(flow, /guard generation == revision[\s\S]*?task = nil[\s\S]*?if let next = pending[\s\S]*?start\(next\)/);
  assert.match(slice("private func cancelWorker()", "func resume("), /worker\.cancel\(\)/);
  assert.match(flow, /func cancel\(\) \{[\s\S]*?pending = nil[\s\S]*?task\?\.cancel\(\)/);
});

test("preparation uses a new verified schedule after syncing Event Cards", () => {
  const prepare = runtime.slice(runtime.indexOf("private func prepare("));
  assert.match(prepare, /NativeEventPreparationFlow\.run\(/);
  assert.match(prepare, /return !\(await retryPendingEventCards/);
  assert.match(prepare, /refreshSchedule: \{ try await verifiedSchedule/);
  assert.match(prepare, /clerk\.user\?\.id == subject && vault\.namespace == scope/);
  assert.match(prepare, /vault\.canContinue\(subject: subject\)/);
  assert.match(flow, /let changed = try await synchronize\(\)[\s\S]*?try check\(\)[\s\S]*?if changed \{ page = try await refreshSchedule\(\)/);
  assert.match(flow, /try check\(\)\s*let events = select\(page\)/);
});

test("a failed event download does not skip remaining downloads or final reminder reconciliation", () => {
  assert.match(flow, /catch \{[\s\S]*?try check\(\)[\s\S]*?result\.failed \+= 1/);
  assert.match(flow, /progress\(result\)[\s\S]*?try await reconcile\(\)/);
  assert.match(runtime, /vault\.skipsAutomaticDownload\(event\.shareToken\)/);
  assert.match(runtime, /try vault\.read\("workspace\/" \+ event\.shareToken\) == data/);
  assert.match(runtime, /Tap Retry to finish missing downloads/);
});

test("settings distinguish an actual future reminder from toggles alone and show a 12-hour next time", () => {
  assert.match(coordinator, /if let next = reminders\.first/);
  assert.match(coordinator, /formatter\.dateFormat = "EEE, MMM d 'at' h:mm a"/);
  assert.match(coordinator, /formatter\.string\(from: next\.fire\)/);
  assert.match(coordinator, /No future reminders are currently saved on this iPhone/);
});

test("preparation fixes preserve verified downloads and acknowledged single-channel delivery", () => {
  assert.match(coordinator, /prepared\.contains\(\$0\.shareToken\)/);
  assert.match(coordinator, /environment\.hasWorkspace\(\$0\.shareToken\)/);
  assert.match(coordinator, /schedule\.linkID == lease\.linkID/);
  assert.match(coordinator, /notBefore: environment\.now\(\)\.addingTimeInterval\(120\)/);
  assert.match(coordinator, /consumedIDs: Set\(saved\.consumed\.keys\)/);
  const disable = push.indexOf("guard await disable(clerk: clerk)");
  const activate = push.indexOf("try await local.activate", disable);
  assert.ok(disable >= 0 && activate > disable);
});

test("live adapters retain encrypted account storage and absolute nonrepeating Apple triggers", () => {
  assert.match(live, /readState: \{ try vault\.read\("local-event-reminders"\) \}/);
  assert.match(live, /writeState: \{ try vault\.write\(\$0, key: "local-event-reminders"\) \}/);
  assert.match(live, /preparedTokens: \{ Set\(vault\.preparedEvents\) \}/);
  assert.match(live, /hasWorkspace: \{ try vault\.read\("workspace\/" \+ \$0\) != nil \}/);
  assert.match(live, /authorityError: NativeOfflineError\.locked/);
  assert.match(live, /calendar\.timeZone = TimeZone\(secondsFromGMT: 0\)!/);
  assert.match(live, /components\.timeZone = calendar\.timeZone/);
  assert.match(live, /try await center\.add\(UNNotificationRequest/);
  assert.match(live, /UNCalendarNotificationTrigger\(dateMatching: components, repeats: false\)/);
  assert.doesNotMatch(coordinator + live, /registerForRemoteNotifications|notifications\/subscriptions/);
});
