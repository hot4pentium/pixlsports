import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../PIXL Sports/${file}`, import.meta.url), "utf8");

test("owner preview name follows Settings without replacing card content", () => {
  const api = read("SupporterHomeAPI.swift");
  const helper = api.slice(api.indexOf("func followingProfile("), api.indexOf("struct NativePublicHypeCard"));
  assert.match(helper, /var publicPreview = publicCard/);
  assert.match(helper, /var privatePreview = privateCard/);
  assert.match(helper, /publicPreview\?\.athleteName = profile\.athleteName/);
  assert.match(helper, /privatePreview\?\.athleteName = profile\.athleteName/);
  assert.match(helper, /privatePhoto: privatePhoto, settings: settings/);
  assert.match(helper, /identityMismatch: false, correctionId: nil/);
  assert.doesNotMatch(helper, /\.paused\s*=|\.showHypeCard\s*=|\.photoUrl\s*=|\.stats\s*=/);
});

test("queued name edits outrank remote profile reads and update the cached card", () => {
  const api = read("SupporterHomeAPI.swift");
  const profile = api.slice(api.indexOf("static func fetchAthleteProfile("), api.indexOf("static func saveAthleteProfile("));
  assert.equal((profile.match(/return pending\.desired/g) ?? []).length, 2);
  const runtime = read("NativeOfflineRuntime.swift");
  const cache = runtime.slice(runtime.indexOf("func cacheSavedAthleteProfile"), runtime.indexOf("func cache(_"));
  assert.match(cache, /preview\.followingProfile\(profile\)/);
  assert.match(cache, /cache\(updated, key: "dashboard-preview"\)/);
});

test("owner startup and refresh align the name before mismatch presentation", () => {
  const view = read("SupporterHypeCardView.swift");
  assert.match(view, /if let cachedProfile \{ preview = preview\?\.followingProfile\(cachedProfile\) \}/);
  assert.match(view, /if let athleteProfile \{ result = result\.followingProfile\(athleteProfile\) \}/);
  const recipient = view.slice(view.indexOf("private func loadPublicCard"));
  assert.doesNotMatch(recipient, /followingProfile/);
});

test("matching-profile retries still reconcile the live card through an owner save", () => {
  const api = read("SupporterHomeAPI.swift");
  const sync = api.slice(api.indexOf("static func syncQueuedAthleteProfile("), api.indexOf("static func resolveAthleteProfile"));
  assert.match(sync, /let remoteMatchesDesired = remote\.hasSameAthleteDetails\(as: current\.desired\)/);
  assert.match(sync, /guard remoteMatchesDesired \|\| remote\.hasSameAthleteDetails\(as: current\.base\)/);
  assert.match(sync, /NativeAthleteProfileVersion\(remoteMatchesDesired \? remote : current\.base\)/);
  assert.doesNotMatch(sync, /if remote\.hasSameAthleteDetails\(as: current\.desired\) \{\s*try client\.clearAthleteProfileChange/);
});
