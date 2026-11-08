import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural regression checks; Apple runtime coverage remains required.
const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const api = read("SupporterHomeAPI.swift");
const home = read("SupporterHomeViewModel.swift");
const client = read("NativeAccountLinkClient.swift");
const runtime = read("NativeOfflineRuntime.swift");

test("a decoded successful profile save replaces the protected profile cache", () => {
  const save = api.slice(api.indexOf("static func saveAthleteProfile("), api.indexOf("static func createEventCard("));
  assert.match(save, /method: "PATCH"/);
  assert.match(save, /guard requestScope == offline\.vault\.namespace, requestSubject == clerk\.user\?\.id else \{\s*throw NativeOfflineError\.locked/);
  assert.match(save, /let saved = try JSONDecoder\(\)\.decode\(NativeSupporterProfile\.self, from: data\)\s*NativeOfflineRuntime\.shared\.cacheSavedAthleteProfile\(data\)\s*return saved/);
  assert.match(runtime, /func cacheSavedAthleteProfile\(_ data: Data\) \{\s*athleteProfileCacheRevision = UUID\(\)\s*cache\(data, key: "get\/supporter\/profile"\)/);
});

test("cache hydration cannot replace an already resolved in-memory profile", () => {
  assert.match(home, /if !hasLoadedAthleteProfile,\s*let data = try\? offline\.vault\.read\("get\/supporter\/profile", subject: previewUserID\)/);
});

test("old profile downloads cannot overwrite the saved profile cache", () => {
  const get = client.slice(client.indexOf("private func networkGetData("), client.indexOf("func postData"));
  assert.match(get, /let profileRevision = NativeOfflineRuntime\.shared\.athleteProfileCacheRevision/);
  assert.match(get, /path != "supporter\/profile" \|\| profileRevision == offline\.athleteProfileCacheRevision/);
  assert.match(get, /requestScope == NativeOfflineVault\.shared\.namespace/);
});

test("setup completion and reset invalidate earlier dashboard requests", () => {
  assert.match(home, /func setAthleteProfile\(_ profile: NativeSupporterProfile\) \{\s*hypePreviewRequestID = UUID\(\)/);
  assert.match(home, /func resetAthleteProfile\(\) \{\s*hypePreviewRequestID = UUID\(\)/);
  const profileRead = home.slice(home.indexOf("if forceProfileReload || !hasLoadedAthleteProfile"), home.indexOf("// Resolve first-time athlete setup"));
  assert.match(profileRead, /let profile = try await[\s\S]*hypePreviewRequestID == previewRequestID,[\s\S]*verifiedScope == offline\.vault\.namespace,[\s\S]*profileRevision == offline\.athleteProfileCacheRevision else \{ return \}\s*athleteProfile = profile/);
});

test("an older unfinished cache is refreshed before presenting setup again", () => {
  assert.match(home, /hasLoadedAthleteProfile = !savedProfile\.needsSetup/);
  assert.match(home, /hasResolvedInitialSchedule = !savedProfile\.needsSetup/);
  assert.match(home, /if forceProfileReload \|\| !hasLoadedAthleteProfile \|\| athleteProfile\?\.needsSetup == true/);
});

test("setup eligibility still uses the real saved profile instead of a bypass", () => {
  assert.match(read("NativeSupporterProfile.swift"), /requiresSetup == true\s*\|\| athleteName\.trimmingCharacters/);
  assert.match(read("ContentView.swift"), /onSaved: \{ profile in\s*viewModel\.setAthleteProfile\(profile\)/);
});
