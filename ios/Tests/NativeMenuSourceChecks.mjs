import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These checks guard source wiring, not Swift compilation or iOS rendering.
const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}.swift`, import.meta.url), "utf8");
const prep = read("NativeEventPrepView");
const settings = read("NativeNotificationSettingsView");
const tools = read("NativeEventTools");
const hype = read("SupporterHypeCardView");
const share = read("NativeEventShareView");
const components = read("SupporterHomeComponents");

test("both native Prep menus group editing before destructive deletion", () => {
  const menus = [...prep.matchAll(/\.contextMenu \{([\s\S]*?)\n\s*\}\n\s*(?:\.accessibilityAction|\.accessibilityHint)/g)];
  assert.equal(menus.length, 2);
  for (const [, menu] of menus) {
    assert.equal((menu.match(/Section \{/g) || []).length, 2);
    assert.match(menu, /Label\("Edit task", systemImage: "pencil"\)/);
    assert.match(menu, /Button\(role: \.destructive\) \{[\s\S]*?removeTask\(id: item\.id\)[\s\S]*?Label\("Delete task", systemImage: "trash"\)/);
    assert.equal((menu.match(/\.disabled\(!model\.canEditLocally\)/g) || []).length, 2);
    assert.ok(menu.indexOf('Label("Edit task"') < menu.indexOf('Label("Delete task"'));
  }
  for (const action of ["Edit task", "Delete task"]) {
    assert.equal(prep.split(`.accessibilityAction(named: "${action}")`).length - 1, 2);
  }
  assert.doesNotMatch(prep, /Remove task|edit or remove it/);
});

test("native confirmations retain destructive roles, explicit cancellation, and original handlers", () => {
  assert.match(prep, /Button\(role: \.destructive\) \{ dismiss\(\) \} label:[\s\S]*?Label\("Leave without saving", systemImage: "trash"\)/);
  assert.match(prep, /Button\("Keep editing", role: \.cancel\)/);
  const recovery = tools.slice(tools.indexOf(".confirmationDialog("));
  assert.equal((recovery.match(/Button\(role: \.destructive\)/g) || []).length, 2);
  assert.match(recovery, /await onKeepLocalPrep\?\(\)/);
  assert.match(recovery, /await model\.discardAndReload\(clerk: clerk\)/);
  assert.match(recovery, /Button\("Cancel", role: \.cancel\)/);
  assert.match(settings, /Button\(role: \.destructive\) \{ Task \{ await signOut\(\) \} \} label:/);
  assert.match(settings, /Button\("Keep my changes", role: \.cancel\)/);
  assert.match(hype, /await saveSettings\(confirmPublish: true\)[\s\S]*?Label\("Publish HYPE Card", systemImage: "globe"\)/);
  assert.match(hype, /await correctHypeCardIdentity\(\)[\s\S]*?Label\("Update HYPE Card identity"/);
});

test("Settings and onboarding group device and other time zones without duplicate values", () => {
  assert.equal((settings.match(/Section\("On this iPhone"\)/g) || []).length, 2);
  assert.equal((settings.match(/Section\("Other time zones"\)/g) || []).length, 2);
  assert.equal((settings.match(/ForEach\(timezoneOptions\.filter \{ \$0 != TimeZone\.current\.identifier \}/g) || []).length, 2);
  assert.equal((settings.match(/\.tag\(TimeZone\.current\.identifier\)/g) || []).length, 2);
  assert.match(settings, /get: \{ model\.preferences\.timezone \?\? TimeZone\.current\.identifier \}/);
  assert.match(settings, /set: \{ value in Task \{ await save\(timezone: value\) \} \}/);
  assert.match(settings, /Picker\("Event-day time zone", selection: \$timezone\)/);
  assert.match(settings, /native-settings-alert-timezone/);
  assert.match(settings, /native-onboarding-alert-timezone/);
});

test("the light native action accent exceeds normal-text contrast on white", () => {
  const values = components.match(/actionTint = Color\(red: ([\d.]+), green: ([\d.]+), blue: ([\d.]+)\)/);
  assert.ok(values);
  const linear = values.slice(1).map(Number).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  assert.ok(1.05 / (luminance + 0.05) >= 4.5);
  assert.equal((settings.match(/\.tint\(NativeMenuAppearance\.actionTint\)/g) || []).length, 2);
  assert.match(hype, /\.tint\(NativeMenuAppearance\.actionTint\)/);
});

test("sharing and reviewing stay separate and retain native sharing with privacy checks", () => {
  assert.match(share, /VStack\(spacing: 12\) \{\s*hypeCardShareAction\s*hypeCardShareCard/);
  assert.match(share, /Label\("Review HYPE Card", systemImage: "person.crop.rectangle"\)/);
  assert.match(share, /ShareLink\(item: shareURL\)/);
  assert.match(share, /Opens the iPhone share sheet with the public HYPE Card link/);
  assert.match(share, /if let shareURL = hypeCardShareURL/);
  assert.match(share, /fetchOwnerHypeCardShareURL\(clerk: clerk\)/);
  assert.match(share, /This HYPE Card is private or paused/);
});
