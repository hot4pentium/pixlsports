import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const dashboard = read("ContentView.swift");
const page = read("NativeSeasonStatsView.swift");
const content = read("NativeSeasonStatsContent.swift");

test("the Season Stats feature card sits directly below Game Record and opens a native page", () => {
  const record = dashboard.indexOf("NativeSeasonRecordView(record: record)");
  const card = dashboard.indexOf('accessibilityIdentifier("dashboard-season-stats")');
  assert.ok(record > 0 && card > record);
  assert.match(dashboard.slice(record, card), /heroDestination = \.seasonStats/);
  assert.match(dashboard, /case \.seasonStats:\s*NativeSeasonStatsView\(clerk: clerk, schedule: schedulePage\)/);
});

test("the private account cache and request generation guard every result", () => {
  assert.match(read("NativeOfflineRuntime.swift"), /"supporter\/season-stats"/);
  assert.match(page, /payloadNamespace == offline\.vault\.namespace/);
  assert.match(page, /subject == payloadSubject/);
  assert.match(page, /offline\.vault\.canContinue\(subject: subject\)/);
  assert.match(page, /getAuthoritativeData\("supporter\/season-stats", clerk: clerk\)/);
  assert.match(page, /loadID == requestID, self\.subject == subject/);
  assert.match(page, /onChange\(of: offline\.revocationGeneration\)[\s\S]*?payload = nil/);
  assert.doesNotMatch(page, /publicToken|fetchPublicHypeCard|UserDefaults/);
});

test("local finals merge only within the selected project and preserve corrected cloud games", () => {
  assert.match(page, /NativeSeasonAnalysis\.canMerge\(/);
  assert.match(read("NativeSeasonStats.swift"), /if let project \{ return project == workspaceProject \}/);
  assert.match(read("NativeSeasonStats.swift"), /workspaceProject == nil && pending && verifiedCurrentEvent/);
  assert.match(page, /workspace\.sport == result\?\.sport/);
  assert.match(page, /game\.status == "final"/);
  assert.match(page, /game\.liveTapsOnly != true, event\?\.type != "practice"/);
  assert.match(page, /existing == nil \|\| model\.pendingStatCount > 0/);
  assert.match(page, /play\.attribution == "athlete" && play\.possessionSide != "opponent"/);
  assert.doesNotMatch(page, /pendingQueue\s*=|removePending|save\("finish"/);
});

test("charts, comparisons and detailed history remain distinct for athlete and team", () => {
  assert.match(content, /Picker\("Stat attribution"/);
  assert.match(content, /LineMark\(x: \.value\("Game date", date\)/);
  assert.match(content, /chartYScale\(domain: 0/);
  assert.match(content, /games without valid dates are excluded/);
  assert.match(content, /datedGames\.dropLast\(\)/);
  assert.match(content, /Earlier-game average/);
  assert.match(content, /NativeSeasonGameDetail\(game: game/);
  assert.match(content, /statSection\("Athlete stats", values: game\.athleteStats\)/);
  assert.match(content, /statSection\("Team stats", values: game\.stats\)/);
});

test("the server uses the verified private schedule owner, never a public HYPE Card token", () => {
  const server = readFileSync(new URL("../../artifacts/api-server/src/routes/nativeAccountLink.ts", import.meta.url), "utf8");
  const start = server.indexOf('nativeAccountLinkRouter.get("/supporter/season-stats"');
  const route = server.slice(start, server.indexOf('nativeAccountLinkRouter.patch("/supporter/hype-card"', start));
  assert.ok(start > server.indexOf("verifyNativeIdentity(header.slice(7))"));
  assert.match(route, /loadNativeSupporterSchedule\(identity\(res\), true\)/);
  assert.match(route, /schedule.status !== "linked"/);
  assert.match(route, /GetNativeSupporterSeasonStatsResponse.parse/);
  assert.match(route, /no-store/);
  assert.doesNotMatch(route, /publicToken|inviteToken|loadNativeSupporterHypeCard/);
});
