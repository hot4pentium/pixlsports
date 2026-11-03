import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../PIXL Sports/NativeAccountLinkClient.swift", import.meta.url), "utf8");
const api = readFileSync(new URL("../PIXL Sports/SupporterHomeAPI.swift", import.meta.url), "utf8");
const view = readFileSync(new URL("../PIXL Sports/SupporterHypeCardView.swift", import.meta.url), "utf8");

test("HYPE Card confirmation marker is stored and read through the account-scoped vault", () => {
  assert.match(client, /hypeCardSettingsConfirmationKey = "pending\/hype-card-settings-confirmation"/);
  const mark = client.slice(
    client.indexOf("func markHypeCardSettingsConfirmationPending"),
    client.indexOf("func hasPendingHypeCardSettingsConfirmation"),
  );
  const read = client.slice(
    client.indexOf("func hasPendingHypeCardSettingsConfirmation"),
    client.indexOf("func clearHypeCardSettingsConfirmation"),
  );
  const clear = client.slice(
    client.indexOf("func clearHypeCardSettingsConfirmation"),
    client.indexOf("private static func requestFailureMessage"),
  );
  for (const method of [mark, read, clear]) {
    assert.match(method, /canContinue\(subject: subject\)/);
    assert.match(method, /hypeCardSettingsConfirmationKey/);
  }
  assert.match(mark, /vault\.write\(JSONEncoder\(\)\.encode\(settings\)/);
  assert.match(read, /vault\.read\([^,]+, subject: subject\)/);
  assert.match(clear, /vault\.write\(nil/);
  assert.match(client, /func loadPendingHypeCardSettingsConfirmation/);
});

test("a HYPE Card mutation is marked before network send and cleared only after decoding", () => {
  const update = api.slice(
    api.indexOf("static func updateNativeHypeCard"),
    api.indexOf("static func fetchAuthoritativeNativeHypeCardSettings"),
  );
  assert.ok(update.indexOf("markHypeCardSettingsConfirmationPending") < update.indexOf("client.postData"));
  assert.ok(update.indexOf("client.postData") < update.indexOf("JSONDecoder().decode"));
  assert.ok(update.indexOf("JSONDecoder().decode") < update.indexOf("clearHypeCardSettingsConfirmation"));
});

test("restart recovery checks authoritative settings and keeps a retry when PIXL is unavailable", () => {
  const load = view.slice(view.indexOf("private func loadCard"), view.lastIndexOf("\n}"));
  const recovery = view.slice(
    view.indexOf("private func reconcileSettingsAfterRestart"),
    view.indexOf("private func applySettings("),
  );
  assert.match(load, /hasPendingHypeCardSettingsConfirmation/);
  assert.match(load, /await checkSavedSettingsStatus\(\)/);
  assert.match(recovery, /fetchAuthoritativeNativeHypeCardSettings/);
  assert.match(recovery, /settingsStatusUnknown = true/);
  assert.match(recovery, /applySettingsDraft\(preservedDraft\)/);
  assert.match(recovery, /preservedDraft\.revision != saved\.revision/);
  assert.doesNotMatch(recovery, /if\s+markerFound\s*\{\s*try client\.clearHypeCardSettingsDraft/);
  assert.doesNotMatch(recovery, /settingsRecoveryMarkerFound\s*\|\|\s*\(try/);
  assert.match(view, /settingsStatusRecoveryNotice/);
  assert.match(view, /Check saved status/);
  assert.match(view, /!settingsStatusUnknown/);
});

test("authoritative settings fetch refreshes the linked account before clearing recovery state", () => {
  const fetch = api.slice(
    api.indexOf("static func fetchAuthoritativeNativeHypeCardSettings"),
    api.indexOf("private static func fetchPublicHypeCard"),
  );
  assert.ok(fetch.indexOf('getAuthoritativeData("supporter/schedule"') < fetch.indexOf('getAuthoritativeData("supporter/hype-card"'));
});

test("cross-device settings conflicts preserve the iPhone draft and require an explicit PIXL choice", () => {
  assert.match(api, /let expectedRevision: String/);
  assert.match(view, /expectedRevision: expectedRevision/);
  assert.match(view, /error\.statusCode == 409/);
  assert.match(view, /settingsRevisionConflict = latest/);
  assert.match(view, /settingsConflictNotice\(settingsRevisionConflict\)/);
  assert.match(view, /Text\(isCheckingSettings \? "Loading PIXL version…" : "Use PIXL version"\)/);
  assert.match(view, /settingsDraftRevision != saved\.revision/);
  assert.match(view, /guard clerk != nil, !isSaving, !isCheckingSettings else \{ return \}/);
});
