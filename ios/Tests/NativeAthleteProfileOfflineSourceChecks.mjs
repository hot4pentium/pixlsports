import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSwift = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const client = readSwift("NativeAccountLinkClient.swift");
const editor = readSwift("NativeAthleteProfileView.swift");
const runtime = readSwift("NativeOfflineRuntime.swift");
const api = readSwift("SupporterHomeAPI.swift");
const hypeCard = readSwift("SupporterHypeCardView.swift");
const profile = readSwift("NativeSupporterProfile.swift");
const server = readFileSync(
  new URL("../../artifacts/api-server/src/lib/nativeSupporterProfile.ts", import.meta.url),
  "utf8",
);
const spec = readFileSync(new URL("../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");

test("athlete profile edits use protected account-scoped pending storage", () => {
  assert.match(profile, /struct NativePendingAthleteProfileChange: Codable/);
  assert.match(client, /athleteProfileChangeKey = "pending\/athlete-profile"/);
  assert.match(client, /vault\.canContinue\(subject: subject\)[\s\S]*vault\.subject == subject/);
  assert.match(client, /vault\.write\(JSONEncoder\(\)\.encode\(change\), key: Self\.athleteProfileChangeKey\)/);
});

test("the editor loads cached profile drafts and blocks stale account state", () => {
  assert.match(editor, /fetchAthleteProfile\(clerk: clerk\)/);
  assert.match(editor, /let working = pending\?\.desired \?\? profile/);
  assert.match(editor, /profileNamespace == offline\.vault\.namespace/);
  assert.match(editor, /clerk\.user\?\.id == profileSubject/);
  assert.match(editor, /native-athlete-profile-account-changed/);
  assert.match(editor, /native-athlete-profile-conflict/);
  assert.match(hypeCard, /clerk\?\.user\?\.id/);
  assert.match(hypeCard, /vault\.canContinue\(subject: subject\)/);
  assert.match(hypeCard, /onChange\(of: clerk\?\.user\?\.id\)[\s\S]*athleteProfile = nil/);
});

test("queued profiles sync only after linked-account confirmation and preserve conflicts", () => {
  assert.match(runtime, /let page = try await verifiedSchedule\(clerk: clerk\)[\s\S]*syncQueuedAthleteProfile\(clerk: clerk\)/);
  assert.match(api, /fetchAuthoritativePrivateSchedule\(clerk: clerk\)/);
  assert.match(api, /remote\.hasSameAthleteDetails\(as: current\.base\)/);
  assert.match(api, /conflictProfile = remote/);
  assert.match(api, /expectedProfile: NativeAthleteProfileVersion\(remoteMatchesDesired \? remote : current\.base\)/);
  assert.match(api, /guard remoteMatchesDesired \|\| remote\.hasSameAthleteDetails\(as: current\.base\)/);
  assert.match(server, /sameProfileVersion\(oldProfile, input\.expectedProfile\)/);
  assert.match(server, /NativeLinkError\(409/);
  assert.match(spec, /NativeSupporterProfileVersion/);
});

