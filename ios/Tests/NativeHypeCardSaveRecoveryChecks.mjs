import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../PIXL Sports/NativeAccountLinkClient.swift", import.meta.url), "utf8");
const api = readFileSync(new URL("../PIXL Sports/SupporterHomeAPI.swift", import.meta.url), "utf8");
const view = readFileSync(new URL("../PIXL Sports/SupporterHypeCardView.swift", import.meta.url), "utf8");
const front = readFileSync(new URL("../PIXL Sports/NativeHypeCardFront.swift", import.meta.url), "utf8");

test("owner HYPE Card startup restores its account-scoped snapshot before requesting PIXL", () => {
  const init = view.slice(view.indexOf("    init(\n"), view.indexOf("    init(publicInviteToken:"));
  assert.match(init, /canUseOwnerCache = publicInviteToken == nil/);
  assert.match(init, /vault\.canContinue\(subject: \$0\)/);
  assert.match(init, /vault\.read\("dashboard-preview", subject: subject\)/);
  assert.match(init, /JSONDecoder\(\)\.decode\(NativeSupporterHypeCardPreview\.self/);
  assert.match(init, /_loading = State\(initialValue: preview == nil\)/);
  assert.match(init, /loadHypeCardSettingsDraft\(subject: subject\)/);
  assert.match(init, /loadHypeCardSettingsSaveIntent\(subject: subject\)/);
  assert.match(init, /editorSettings = savedDraft \?\? cachedSettings/);
  assert.match(init, /_settingsDraftRevision = State\(initialValue: editorSettings\?\.revision\)/);
  assert.match(init, /_settingsDraftRecoveryBlocked = State\(initialValue: draftRecoveryBlocked\)/);
  assert.match(init, /_settingsStatusUnknown = State\(initialValue: confirmationPending\)/);
  assert.doesNotMatch(view, /Use PIXL version|Keep my iPhone draft|The PIXL version is loaded/);
  assert.doesNotMatch(init, /await|fetchOwnerHypeCardPreview/);
});

test("the owner screen saves a complete matching preview independently of dashboard loading", () => {
  const load = view.slice(view.indexOf("private func loadCard"), view.indexOf("private func loadPublicCard"));
  assert.match(load, /identityMismatch = result\.identityMismatch \|\| !matchesProfile/);
  assert.match(load, /if !identityMismatch, let data = try\? JSONEncoder\(\)\.encode\(result\)/);
  assert.match(load, /offlineRuntime\.cache\(data, key: "dashboard-preview"\)/);
  assert.match(load, /Your saved HYPE Card is shown\. It couldn’t be refreshed right now\./);
  assert.match(load, /guard !Task\.isCancelled, Self\.ownerSubject\(clerk: clerk\) == requestSubject/);
});

test("cold offline startup uses only the authenticated root's bounded continuation lease", () => {
  const subject = view.slice(view.indexOf("private static func ownerSubject"), view.indexOf("private var ownerSubject:"));
  assert.match(subject, /if let subject = clerk\.user\?\.id \{ return subject \}/);
  assert.match(subject, /guard !offline\.online \|\| !clerk\.isLoaded,/);
  assert.match(subject, /offline\.vault\.canContinue\(subject: nil\) else \{ return nil \}/);
  assert.match(subject, /return offline\.vault\.subject/);
  assert.match(view, /settingsAccountSubject == ownerSubject/);
  assert.match(view, /offlineRuntime\.vault\.canContinue\(subject: settingsAccountSubject\)/);
});

test("published owner fronts use cached photo bytes without giving them to public recipients", () => {
  const face = view.slice(view.indexOf("private func frontCardFace"), view.indexOf("private func flipFrontContent"));
  assert.match(face, /privatePhoto: isPublicRecipient \? nil : privatePhoto/);
  assert.ok(front.indexOf("if let privatePhoto") < front.indexOf("else if let photoURL"));
});

test("a settings save is stored locally first and then syncs automatically when online", () => {
  const save = view.slice(view.indexOf("private func saveSettings"), view.indexOf("private func syncQueuedSettings"));
  assert.ok(save.indexOf("saveHypeCardSettingsDraft") < save.indexOf("saveHypeCardSettingsSaveIntent"));
  assert.ok(save.indexOf("saveHypeCardSettingsSaveIntent") < save.indexOf("syncQueuedSettings"));
  assert.match(save, /Saved on this iPhone\. It will sync automatically/);
  assert.match(view, /private func syncQueuedSettings\(subject: String\) async/);
  assert.match(view, /offlineRuntime\.online, clerk\.isLoaded/);
  assert.match(client, /hypeCardSettingsSaveIntentKey = "pending\/hype-card-settings-save"/);
});

test("queued HYPE Card saves are encrypted and scoped to the signed-in account", () => {
  const save = client.slice(
    client.indexOf("func saveHypeCardSettingsSaveIntent"),
    client.indexOf("func markHypeCardSettingsConfirmationPending"),
  );
  assert.match(save, /canContinue\(subject: subject\)/);
  assert.match(save, /vault\.write\(JSONEncoder\(\)\.encode\(intent\), key: Self\.hypeCardSettingsSaveIntentKey\)/);
  assert.match(save, /vault\.read\(Self\.hypeCardSettingsSaveIntentKey, subject: subject\)/);
  assert.match(save, /vault\.write\(nil, key: Self\.hypeCardSettingsSaveIntentKey\)/);
});

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

test("restart recovery preserves local choices and retries an explicitly saved change", () => {
  const load = view.slice(view.indexOf("private func loadCard"), view.lastIndexOf("\n}"));
  const recovery = view.slice(
    view.indexOf("private func reconcileSettingsAfterRestart"),
    view.indexOf("private func applySettings("),
  );
  assert.match(load, /hasPendingHypeCardSettingsConfirmation/);
  assert.match(load, /await checkSavedSettingsStatus\(\)/);
  assert.match(load, /await syncQueuedSettings\(subject: requestSubject\)/);
  assert.match(recovery, /fetchAuthoritativeNativeHypeCardSettings/);
  assert.match(recovery, /settingsStatusUnknown = true/);
  assert.match(recovery, /loadHypeCardSettingsSaveIntent\(subject: subject\)/);
  assert.match(recovery, /await syncQueuedSettings\(subject: subject\)/);
  assert.match(recovery, /localDraft\.hasSameSettings\(as: queuedIntent\.desired\)/);
  assert.match(recovery, /Tap Save to sync them/);
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

test("cross-device settings changes merge automatically without a version-choice screen", () => {
  assert.match(api, /let expectedRevision: String/);
  assert.match(view, /expectedRevision: revision/);
  assert.match(view, /error\.statusCode == 409/);
  assert.match(view, /for attempt in 0\.\.<3/);
  assert.match(view, /mergeSettings\(base: queuedIntent\.base, local: queuedIntent\.desired, latest: latest\)/);
  assert.match(view, /hasNewerLocalDraft/);
  assert.doesNotMatch(view, /settingsConflictNotice|settingsRevisionConflict|Use PIXL version|The PIXL version is loaded/);
  assert.match(view, /settingsDraftRevision != nil/);
  assert.match(view, /guard clerk != nil, !isSaving, !isCheckingSettings else \{ return \}/);
  const editable = view.slice(view.indexOf("private var canEditSettingsDraft"), view.indexOf("private var showHypeCardBinding"));
  assert.doesNotMatch(editable, /settingsStatusUnknown/);
});

test("local drafts are removed only after PIXL confirms the queued settings", () => {
  const sync = view.slice(
    view.indexOf("private func syncQueuedSettings"),
    view.indexOf("private func mergeSettings"),
  );
  assert.match(sync, /latest\.hasSameSettings\(as: queuedIntent\.desired\)/);
  assert.match(sync, /saved\.hasSameSettings\(as: merged\)/);
  const finish = view.slice(
    view.indexOf("private func finishQueuedSettingsSync"),
    view.indexOf("private func mergeSettings"),
  );
  assert.match(finish, /clearHypeCardSettingsSaveIntent/);
  assert.match(finish, /preserveNewerDraft/);
  assert.match(finish, /clearHypeCardSettingsDraft/);
});
