import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");

test("Event Card creation explains its connection requirement and offers a safe retry", () => {
  const view = source("NativeCreateEventCardView.swift");
  assert.match(view, /Creating an Event Card needs a connection to PIXL/);
  assert.match(view, /A connection to PIXL is required to create this Event Card/);
  assert.match(view, /Button\("Try again"\)[\s\S]*?Task \{ await saveEventCard\(\) \}/);
  assert.match(view, /accessibilityIdentifier\("native-event-create-retry"\)/);
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
  assert.match(content, /message: viewModel\.fanBaseError \?\? ""/);
  assert.match(content, /Task \{ await loadSchedule\(\) \}/);
  assert.match(api, /guard NativeOfflineRuntime\.shared\.online else \{\s*throw NativeOfflineError\.onlineOnly/);
  assert.match(status, /Loading the latest Fan Base count/);
  assert.match(status, /Button\("Try again", action: retry\)/);
});
