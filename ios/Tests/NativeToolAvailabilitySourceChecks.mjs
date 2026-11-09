import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}.swift`, import.meta.url), "utf8");
const coordinator = read("NativeToolAvailabilityReminderCoordinator");
const routine = read("NativeLocalEventReminderCoordinator");
const runtime = read("NativeOfflineRuntime");
const plan = read("NativeLocalReminderPlan");
const has = (source, regex, message) => assert.ok(regex.test(source), message);

test("availability consent is per event and independent of ordinary alert registration", () => {
  has(coordinator, /func optIn\(token: String, subject: String\)/, "explicit opt-in");
  has(coordinator, /requestAuthorization\(options: \[\.alert, \.sound\]\)/, "request permission only for opt-in");
  const rebuild = coordinator.slice(coordinator.indexOf("private func rebuild"));
  assert.ok(!/requestAuthorization|registerForRemoteNotifications|notifications\/subscriptions/.test(rebuild));
  assert.ok(!/setLocalReminders|updatePreferences|\.activate\(/.test(coordinator));
  has(coordinator, /accountRevision == accountGeneration/, "late permission callbacks fence account changes");
  has(coordinator, /version == optInVersions\[token, default: 0\]/, "cancelling also fences a pending opt-in");
  has(coordinator, /Opening Apple's permission dialog/, "ordinary foreground refresh must not cancel opt-in");
});

test("verified private downloads and readable pending changes authorize the plan", () => {
  for (const pattern of [/schedule\.status == "linked"/, /schedule\.linkId == lease\.linkId/,
    /workspace\.linkId == lease\.linkId/, /vault\.pendingEventCardIDs/,
    /change\.id == id/, /model\.trackerIsComplete/, /model\.unreadablePendingData/]) {
    has(coordinator, pattern, `missing private authority guard: ${pattern}`);
  }
  has(coordinator, /draft\?\.timezone \?\? event\.timezone \?\? schedule\.timezone/, "event time zone, not device default");
  has(plan, /let fire = start\.addingTimeInterval\(-600\)/, "ten-minute opening");
  has(plan, /fire > now && fire <= leaseEnd/, "no late alerts or lease extension");
  has(plan, /let start, start <= leaseEnd/, "the event must also fit the lease");
});

test("reminder identities, consumed attempts and opt-ins survive time edits without replay", () => {
  has(plan, /"pixl\.native\.availability\." \+ scope \+ "\." \+ token/, "account and card namespace");
  has(coordinator, /attemptedFire\.map\(\{ \$0 <= checkedAt \}\)/, "uncertain past delivery is consumed");
  has(coordinator, /if entry\.consumed \{[\s\S]*?continue/, "consumed entries are not rearmed by refresh");
  has(coordinator, /if let fire = entry\.attemptedFire, fire > Date\(\), !entry\.consumed/, "known future cancellations can move");
  has(coordinator, /func eventChanged[\s\S]*?if deleted \{[\s\S]*?cancel\(token: token/, "deletion cancels synchronously");
  has(runtime, /try vault\.write\(JSONEncoder\(\)\.encode\(change\), key: key\)[\s\S]*?\.eventChanged\(/, "durable local edit before alert update");
  has(runtime, /func storageChanged[\s\S]*?NativeToolAvailabilityReminderCoordinator\.shared\.reconcile/, "offline Final and queue changes reconcile");
});

test("reconciliation cannot erase another reminder category", () => {
  assert.ok(!/removeAllPendingNotificationRequests|removeAllDeliveredNotifications/.test(routine));
  const noAccountCleanup = coordinator.replace(/func cancelForAccount\(\) \{[\s\S]*?\n    \}/, "");
  assert.ok(!/removeAllPendingNotificationRequests|removeAllDeliveredNotifications/.test(noAccountCleanup));
  has(routine, /pending\.filter \{ \$0\.identifier\.hasPrefix\(Self\.prefix\) \}/, "routine prefix cancellation");
  has(coordinator, /pending\.filter \{ \$0\.identifier\.hasPrefix\(Self\.prefix\) \}/, "availability prefix cancellation");
  has(routine, /guard revision == generation/, "routine late callbacks fenced");
  has(coordinator, /guard valid\(revision, scope, subject\)/, "availability late callbacks fenced");
});

test("categories share capacity and confirmations follow accepted iOS requests", () => {
  has(plan, /static let limit = 16/, "availability reservation");
  has(routine, /prefix\(max\(0, 48 - foreignCount\)\)/, "routine reservation and unknown categories");
  has(coordinator, /capacity\(otherCategoryCount: foreignCount\)/, "availability counts unknown categories");
  const add = coordinator.indexOf("try await center.add");
  const confirmation = coordinator.indexOf("confirmed.insert(token)", add);
  assert.ok(add > 0 && confirmation > add);
  has(coordinator.slice(add, confirmation), /catch \{[\s\S]*?continue/, "failed adds do not claim confirmation");
  has(coordinator, /guard fire > Date\(\)/, "do not add an already-past instant");
  has(coordinator, /components\.timeZone = calendar\.timeZone/, "absolute UTC trigger");
});

test("availability stays inline in foreground and account cleanup cancels private alerts", () => {
  const push = read("NativePushRegistrationCoordinator");
  has(push, /categoryIdentifier == "PIXL_TOOL_AVAILABILITY"[\s\S]*?completionHandler\(\[\]\)/, "no redundant foreground banner");
  has(push, /else \{\s*completionHandler\(\[\.banner, \.sound, \.badge\]\)/, "other alerts unchanged");
  const vault = read("NativeOfflineVault");
  for (const method of ["lock", "clear"]) {
    const body = vault.slice(vault.indexOf(`func ${method}()`), vault.indexOf(`func ${method}()`) + 400);
    has(body, /NativeToolAvailabilityReminderCoordinator\.shared\.cancelForAccount/, `${method} cancels pending account alerts`);
  }
  has(coordinator, /state\.selections\.values\.allSatisfy\(\{ \$0\.consumed \}\)/, "no workspace loading for empty or consumed opt-ins");
  has(coordinator, /tokens\.contains\(event\.shareToken\)/, "only selected events load workspaces");
});

test("navigation and full-tracker timing use the same local working event", () => {
  has(read("SupporterEventDetailView"), /offline\.workingEvent\(event, subject: clerk\?\.user\?\.id\)/, "detail working copy");
  has(read("NativeEventTrackerView"), /offline\.workingEvent\(event, subject: clerk\.user\?\.id\)/, "full tracker working copy");
  has(runtime, /guard change\.operation != \.delete else \{ return nil \}/, "pending delete blocks stale entry");
  has(runtime, /date: draft\.date, time: draft\.time, type: draft\.type/, "same pending time and type");
  has(read("NativeToolAvailabilityNotice"), /ReminderCoordinator\.shared/, "real reminder controls, not placeholder UI");
});
