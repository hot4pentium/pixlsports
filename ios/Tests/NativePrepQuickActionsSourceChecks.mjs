import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Native gesture execution requires Apple tooling; these guard the action wiring.
const prep = readFileSync(new URL("../PIXL Sports/NativeEventPrepView.swift", import.meta.url), "utf8");
const quickRow = prep.slice(prep.indexOf("private func quickChecklistItem"), prep.indexOf("private func prepNavigationLabel"));
const quickEditor = prep.slice(prep.indexOf("private func editQuickTask"), prep.indexOf("private func beginEditingTask"));

test("the main checkoff rows themselves offer Edit and Delete", () => {
  assert.match(quickRow, /toggleItem\(id: item\.id\)/);
  assert.match(quickRow, /\.contextMenu \{[\s\S]*editQuickTask\(item\)[\s\S]*Label\("Edit task"[\s\S]*Button\("Delete task", role: \.destructive\)[\s\S]*removeTask\(id: item\.id\)/);
});

test("editing a main-screen task uses an inline alert rather than Manage navigation", () => {
  assert.match(quickEditor, /beginEditingTask\(item, focusEditor: false\)/);
  assert.match(quickEditor, /showingQuickTaskEditor = true/);
  assert.doesNotMatch(quickEditor, /isManagingFullPrep\s*=/);
  assert.match(prep, /\.alert\("Edit task", isPresented: \$showingQuickTaskEditor\) \{[\s\S]*TextField\("Task", text: \$editingTaskText\)[\s\S]*Button\("Save"\) \{ saveTaskEntry\(\) \}[\s\S]*Button\("Cancel", role: \.cancel\) \{ cancelTaskEdit\(\) \}/);
});

test("task renaming preserves identity and checkoff state and autosaves", () => {
  const edit = prep.slice(prep.indexOf("if let editingTaskID {", prep.indexOf("private func saveTaskEntry")), prep.indexOf("guard items.count < 100", prep.indexOf("private func saveTaskEntry")));
  assert.match(edit, /items\.firstIndex\(where: \{ \$0\.id == editingTaskID \}\)/);
  assert.match(edit, /items\[index\]\.label = label[\s\S]*scheduleChecklistAutosave\(\)/);
  assert.doesNotMatch(edit, /\.completed\s*=|NativePrepItem\(/);
});

test("deletion targets only that task and uses the existing autosave path", () => {
  const remove = prep.slice(prep.indexOf("private func removeTask"), prep.indexOf("private func toggleItem"));
  assert.match(remove, /guard model\.canEditLocally else \{ return \}/);
  assert.match(remove, /items\.removeAll \{ \$0\.id == id \}/);
  assert.match(remove, /scheduleChecklistAutosave\(\)/);
  assert.doesNotMatch(remove, /notes\s*=|deleteEvent|statTap|removeAll\(\)/);
});

test("main-screen actions are discoverable without a long-press gesture", () => {
  assert.match(quickRow, /\.accessibilityAction\(named: "Edit task"\)/);
  assert.match(quickRow, /\.accessibilityAction\(named: "Delete task"\)/);
  assert.match(quickRow, /\.disabled\(!model\.canEditLocally\)/);
});
