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
  assert.match(init, /editorSettings = savedDraft \?\? cachedSettings/);
  assert.match(init, /_settingsDraftRevision = State\(initialValue: editorSettings\?\.revision\)/);
  assert.match(init, /_settingsDraftRecoveryBlocked = State\(initialValue: draftRecoveryBlocked\)/);
  assert.match(init, /_settingsStatusUnknown = State\(initialValue: confirmationPending\)/);
  assert.match(init, /cachedConflict = cachedSettings/);
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

test("a known-offline save keeps editable local choices without creating an uncertain cloud request", () => {
  const save = view.slice(view.indexOf("private func saveSettings"), view.indexOf("private func keepSettingsDraft"));
  const start = save.indexOf("if !offlineRuntime.online");
  const request = save.indexOf("SupporterHomeAPI.updateNativeHypeCard");
  assert.ok(start >= 0 && start < request);
  const local = save.slice(start, request);
  assert.match(local, /saveHypeCardSettingsDraft\(submittedDraft, subject: subject\)/);
  assert.match(local, /Saved on this iPhone\./);
  assert.match(local, /return/);
  assert.doesNotMatch(local, /markHypeCardSettingsConfirmationPending|settingsStatusUnknown = true|clearHypeCardSettingsDraft/);
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
