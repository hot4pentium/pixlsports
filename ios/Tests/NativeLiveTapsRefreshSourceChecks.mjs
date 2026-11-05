import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural regression checks, not SwiftUI execution. See the companion
// device checklist for cancellation, remote sends and visible layout behavior.
const source = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const view = source("SupporterLiveTapsView.swift");
const loop = view.slice(view.indexOf("private func refreshWhileActive"), view.indexOf("private func loadSummary"));
const load = view.slice(view.indexOf("private func loadSummary"), view.indexOf("private var hasCheerAccess"));

test("one lifecycle-owned task drives bounded, non-overlapping refreshes", () => {
  assert.match(view, /\.task\(id: refreshKey\) \{ await refreshWhileActive\(refreshKey\) \}/);
  assert.match(loop, /guard key\.active else \{ return \}/);
  assert.match(loop, /await loadSummary\(key\)[\s\S]*try await Task\.sleep\(for: \.seconds\(error == nil \? 5 : 15\)\)/);
  assert.match(loop, /guard !Task\.isCancelled, key == refreshKey, key\.online else \{ return \}/);
  assert.match(loop, /catch \{ return \}/);
  assert.equal((view.match(/await loadSummary\(/g) ?? []).length, 1);
  assert.doesNotMatch(loop, /Task\s*\{|Timer|try\? await Task\.sleep/);
});

test("hidden retained tools and inactive scenes cannot continue polling", () => {
  assert.match(view, /active: isActive && scenePhase == \.active/);
  assert.match(source("NativeEventTrackingPanel.swift"), /NativeEventFanAccessView\([\s\S]*?isActive: isActive && selectedMode == \.liveTaps/);
  assert.match(source("NativeEventFanAccessView.swift"), /SupporterLiveTapsView\([\s\S]*?isActive: isActive/);
  assert.match(view, /online: offline\.online, generation: refreshGeneration/);
});

test("account, event and access revocation changes invalidate old refreshes", () => {
  for (const field of ["inviteToken", "sport", "eventId", "ownerId", "namespace", "revocationGeneration"]) {
    assert.match(view, new RegExp(`let ${field}:`));
  }
  assert.match(loop, /if loadedContext != key\.context \{[\s\S]*outboxScope = nil[\s\S]*summary = nil/);
  assert.match(view, /guard loadedContext == refreshKey\.context else \{ return \}/);
  assert.match(load, /let result = try await SupporterHomeAPI\.fetchLiveTapSummary[\s\S]*guard !Task\.isCancelled, key == refreshKey, outboxScope == scope else \{ return \}/);
  assert.match(load, /catch \{[\s\S]*guard !Task\.isCancelled, key == refreshKey else \{ return \}/);
});

test("routine refresh keeps totals visible and accepts session replacement or end", () => {
  assert.match(load, /if summary == nil \{ loading = true \}/);
  assert.doesNotMatch(load.slice(0, load.indexOf("let result =")), /summary = nil|error = nil/);
  assert.match(load, /guard result\.sport == sport else/);
  assert.match(load, /summary = result\.summary/);
  assert.doesNotMatch(load, /result\.summary\.active|result\.summary\.gameId == summary/);
  assert.match(load, /Couldn’t refresh the totals/);
});

test("manual refresh and retry restart the same task rather than racing it", () => {
  assert.match(view, /Button\("Refresh cheers"\) \{ refreshGeneration \+= 1 \}/);
  assert.match(view, /Button\("Check again"\) \{ refreshGeneration \+= 1 \}/);
  assert.match(view, /refreshGeneration \+= 1[\s\S]*accessibilityIdentifier\("live-taps-retry"\)/);
  assert.doesNotMatch(view, /Task \{ await loadSummary/);
});

test("remote refresh never sends a cheer or replays local send feedback", () => {
  assert.doesNotMatch(loop + load, /\bsend\(|enqueue\(|pendingCheerKeys|UIImpactFeedbackGenerator|UINotificationFeedbackGenerator|sensoryFeedback|withAnimation/);
  assert.match(view, /try outbox\.enqueue\(cheerKey, scope: outboxScope, accessToken: accessToken\)/);
});

test("summary API checks cancellation before requesting and after receiving", () => {
  const api = source("SupporterHomeAPI.swift");
  const fetch = api.slice(api.indexOf("static func fetchLiveTapSummary"), api.indexOf("static func sendLiveTap"));
  assert.equal((fetch.match(/try Task\.checkCancellation\(\)/g) ?? []).length, 2);
  assert.match(fetch, /publicRequest\(\s*"athlete-invites\/\\\(inviteToken\)\/fan"/);
  assert.doesNotMatch(fetch, /sendLiveTap|method: "POST"/);
});
