import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");

test("notification setup is enrolled during initial athlete setup and stays pending after interruption", () => {
  const progress = read("NativeWeeklyWelcomeProgress.swift");
  assert.match(progress, /notificationSetupKey: String \{ storageKey \+ "\.event-card-alerts" \}/);
  assert.match(progress, /func beginInitialSetup\(\)[\s\S]*?defaults\.set\("pending", forKey: notificationSetupKey\)/);
  assert.match(progress, /var isNotificationSetupPending: Bool[\s\S]*?defaults\.string\(forKey: notificationSetupKey\) == "pending"/);
  assert.match(progress, /func acknowledgeNotificationSetup\(\)[\s\S]*?defaults\.set\("done", forKey: notificationSetupKey\)/);
});

test("new iPhone athlete setup presents alert choices before the weekly welcome", () => {
  const content = read("ContentView.swift");
  const setup = content.indexOf("if viewModel.needsAthleteProfileSetup");
  const scheduleGate = content.indexOf("viewModel.athleteProfile?.needsSetup == false", setup);
  const reminders = content.indexOf("progress.isNotificationSetupPending", scheduleGate);
  const welcome = content.indexOf("progress.isPending", reminders);
  assert.ok(setup >= 0 && scheduleGate > setup && reminders > scheduleGate && welcome > reminders);
  assert.match(content, /NativeOnboardingNotificationSettingsView\([\s\S]*?initialTimezone: schedulePage\?\.timezone/);
});

test("onboarding alert choices save preferences and explicitly request notification permission", () => {
  const settings = read("NativeNotificationSettingsView.swift");
  const page = settings.slice(settings.indexOf("struct NativeOnboardingNotificationSettingsView"));
  assert.match(page, /Toggle\("Allow event-day and one-hour alerts"/);
  assert.match(page, /Toggle\("Remind me without reception"/);
  assert.match(page, /Toggle\("One hour before"/);
  assert.match(page, /Toggle\("Event day"/);
  assert.match(page, /Picker\("Event-day time zone"/);
  assert.match(page, /Button\(action: onComplete\) \{\s*Text\("Not now"\)\.nativeToolbarLabel\(\)/);
  assert.match(page, /Text\("Not now"\)\.nativeToolbarLabel\(\)[\s\S]*?\.disabled\(isSaving \|\| model\.isSaving\)/);
  assert.match(page, /Save and enable alerts/);
  assert.match(page, /model\.save\([\s\S]*?oneHourBefore: oneHourBefore,[\s\S]*?dayOf: dayOf,[\s\S]*?timezone: timezone/);
  assert.match(page, /pushCoordinator\.enable\(clerk: clerk\)/);
  assert.match(page, /pushCoordinator\.disable\(clerk: clerk\)/);
  assert.match(page, /pushCoordinator\.setLocalReminders\(true, clerk: clerk\)/);
});

test("the app supplies its push coordinator to the onboarding destination", () => {
  const root = read("NativeAuthRootView.swift");
  assert.match(root, /ContentView\([\s\S]*?\)\s*#if os\(iOS\)\s*\.environmentObject\(notificationCoordinator\)/);
});
