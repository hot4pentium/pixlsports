import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");

test("Event Card creation saves a local draft and offers a safe sync retry", () => {
  const view = source("NativeCreateEventCardView.swift");
  const runtime = source("NativeOfflineRuntime.swift");
  assert.match(view, /Event Cards sync to your PIXL account/);
  assert.match(view, /savePendingEventCard\(change, subject: subject\)/);
  assert.match(view, /retryPendingEventCards\(clerk: clerk, onlyID: draft\.id\)/);
  assert.match(runtime, /pending\/event-card\//);
  assert.match(runtime, /Saved on this iPhone/);
  assert.match(view, /accessibilityIdentifier\("native-event-create-local-status"\)/);
  assert.doesNotMatch(view, /error\.localizedDescription/);
  assert.match(view, /id:\s*eventID/);
});

test("Fan Base failures hide any count and explain that no current count is available", () => {
  const model = source("SupporterHomeViewModel.swift");
  const content = source("ContentView.swift");
  const api = source("SupporterHomeAPI.swift");
  const status = source("NativeSeasonRecordView.swift");
  assert.match(model, /fanBase = nil\s*fanBaseIsLoading = false\s*fanBaseError = nil/);
  assert.match(model, /The latest Fan Base count couldn’t be loaded, so no current count is shown/);
  assert.match(content, /message: displayedFanBaseError \?\? "Fan Base details aren’t available right now\. Try again\."/);
  assert.match(content, /Task \{ await loadSchedule\(\) \}/);
  assert.match(api, /guard NativeOfflineRuntime\.shared\.online else \{\s*throw NativeOfflineError\.onlineOnly/);
  assert.match(status, /Loading the latest Fan Base count/);
  assert.match(status, /Button\("Try again", action: retry\)/);
});

test("Event Card edits use the protected offline queue with explicit conflict choices", () => {
  const detail = source("SupporterEventDetailView.swift");
  const content = source("ContentView.swift");
  const runtime = source("NativeOfflineRuntime.swift");
  assert.match(detail, /event-detail-edit-card/);
  assert.match(detail, /existingEvent: event/);
  assert.match(content, /Text\("Event Cards waiting to sync"\)/);
  assert.match(content, /Keep my iPhone edits/);
  assert.match(content, /Use server version/);
  assert.match(content, /Create as new Event Card/);
  assert.match(runtime, /pending\/event-card\//);
  assert.match(runtime, /expected: base/);
  assert.match(runtime, /PIXL could not be reached/);
  assert.match(runtime, /The PIXL server did not respond/);
  assert.match(runtime, /Reconnect your iPhone account/);
});
