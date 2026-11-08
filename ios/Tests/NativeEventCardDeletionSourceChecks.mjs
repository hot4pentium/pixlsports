import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [runtime, api, dashboard, editor, serverRoute] = await Promise.all([
  readFile(new URL("../PIXL Sports/NativeOfflineRuntime.swift", import.meta.url), "utf8"),
  readFile(new URL("../PIXL Sports/SupporterHomeAPI.swift", import.meta.url), "utf8"),
  readFile(new URL("../PIXL Sports/ContentView.swift", import.meta.url), "utf8"),
  readFile(new URL("../PIXL Sports/NativeCreateEventCardView.swift", import.meta.url), "utf8"),
  readFile(new URL("../../artifacts/api-server/src/routes/nativeAccountLink.ts", import.meta.url), "utf8"),
]);

test("offline deletion is a durable queue operation and local drafts cancel without a network request", () => {
  assert.match(api, /case delete/);
  assert.match(runtime, /enum NativeEventCardDeletionStageResult: Equatable/);
  assert.match(runtime, /change\.operation == \.create,\s*change\.shareToken == nil,\s*change\.attemptedDraft == nil/s);
  assert.match(runtime, /removePendingEventCard\(id: event\.eventId, subject: subject\)/);
  assert.match(runtime, /change\.operation = \.delete/);
  assert.match(runtime, /savePendingEventCard\(change, subject: subject\)/);
});

test("queued deletion remains hidden until PIXL confirms the exact Event Card is gone", () => {
  assert.match(runtime, /if change\.operation == \.delete/);
  assert.match(runtime, /SupporterHomeAPI\.deleteEventCard\(shareToken: token, clerk: clerk\)/);
  assert.match(runtime, /fetchAuthoritativePrivateSchedule\(clerk: clerk\)/);
  assert.match(runtime, /!confirmedSchedule\.events\.contains\(where: \{ \$0\.shareToken == token \}\)/);
  assert.ok(dashboard.includes("eventCardIsHidden(_ eventId: String)"));
  assert.ok(dashboard.includes("$0.id == eventId && $0.operation == .delete"));
});

test("an in-flight create or edit cannot replace a newer delete tombstone", () => {
  assert.ok(runtime.includes("latestAfterCreate.operation == .create"));
  assert.ok(runtime.includes("latestAfterCreateConfirmation.operation == .create"));
  assert.ok(runtime.includes("latestAfterUpdate.operation == .update"));
  assert.ok(runtime.includes("latestAfterConfirmation.operation == .update"));
  assert.ok(editor.includes("change.operation != .delete"));
});

test("both dashboard layouts expose edit/delete while preserving tap-through navigation", () => {
  assert.equal((dashboard.match(/contextMenu \{ eventCardManagementMenu\(for: item\.event\) \}/g) ?? []).length, 2);
  assert.match(dashboard, /Button \{\s*heroDestination = \.editEventCard\(event\.shareToken\)/s);
  assert.match(dashboard, /showingEventCardDeleteConfirmation = true/);
  assert.match(dashboard, /Stats and game history for this date stay saved/);
});

test("native delete endpoint delegates through the authenticated account link", () => {
  assert.ok(serverRoute.includes('nativeAccountLinkRouter.delete("/supporter/event-cards/:shareToken"'));
  assert.ok(serverRoute.includes("deleteNativeSupporterEventCard(identity(res), parsedToken.data)"));
});
