import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}.swift`, import.meta.url), "utf8");

test("native timer publishers explicitly import Combine", () => {
  for (const name of ["SupporterEventDetailView", "NativeEventTrackerView", "NativeOfflineRuntime"]) {
    const source = read(name);
    assert.match(source, /Timer\.publish[\s\S]*?\.autoconnect\(\)/);
    assert.match(source, /^import Combine$/m, `${name} needs Combine for autoconnect().`);
  }
});

test("one inclusive policy guards timed tools without locking the chooser or recording", () => {
  const policy = read("NativeEventDetailStep");
  assert.match(policy, /addingTimeInterval\(-10 \* 60\)/);
  assert.match(policy, /now >= opensAt/);
  assert.match(policy, /guard !isComplete else \{ return \.complete \}/);
  const detail = read("SupporterEventDetailView");
  assert.match(detail, /trackingAvailable: trackingAccess/);
  assert.match(detail, /trackingAllowed: trackingAccess/);
  assert.match(detail, /onReceive\(Timer\.publish/);
  assert.match(detail, /date: max\(accessDate, Date\(\)\)/);
  assert.match(read("NativeEventStepBar"), /disabled\(!isGame\)/);
  assert.doesNotMatch(read("NativeEventStepBar"), /disabled\([^)]*isComplete/);
  assert.match(read("NativeEventToolPanel"), /sessionManagementOnly|trackingAllowed: trackingAllowed/);
  const panel = read("NativeEventTrackingPanel");
  assert.match(panel, /guard isActive, chooserAvailable, modeAllowed\(mode\)/);
  assert.match(panel, /mode == \.recordMoments \|\| \(trackingAllowed && !gameIsComplete/);
  assert.match(panel, /if chooserAvailable && isActive \{ modePickerSheet \}/);
  const editor = panel.slice(panel.indexOf(".fullScreenCover"), panel.indexOf(".onAppear"));
  assert.doesNotMatch(editor, /trackingAllowed|gameIsComplete/);
  const changes = panel.slice(panel.indexOf(".onChange(of: gameIsComplete"), panel.indexOf("private var modePickerSheet"));
  assert.doesNotMatch(changes, /showingRecordMoments = false/);
  assert.match(read("NativeEventTrackerView"), /if !trackingAccess\.isAllowed/);
});

test("private owner context replaces public-card startup and authenticated owner refreshes stay separate", () => {
  const fan = read("NativeEventFanAccessView");
  assert.match(fan, /fetchOwnerLiveTapsContext\(clerk: clerk\)/);
  assert.doesNotMatch(fan, /fetchPublicHypeCard|No active Player Showcase/);
  assert.match(fan, /guard !sessionManagementOnly, !startingLiveTaps/);
  assert.match(fan, /fetchLiveTapSummary\(inviteToken: inviteToken, ownerClerk: clerk\)/);
  assert.match(read("SupporterLiveTapsView"), /fetchLiveTapSummary\(inviteToken: inviteToken, ownerClerk: ownerClerk\)/);
  assert.match(read("SupporterHomeAPI"), /getAuthoritativeData\(\s*"athlete-invites\/\\\(inviteToken\)\/live-taps"/);
});

test("locked events retain session ending outside the tab and standalone moments are not time gated", () => {
  assert.match(read("NativeEventToolPanel"), /\(isComplete \|\| !trackingAllowed\) && selected == \.share && event\.liveTapsActive/);
  const fan = read("NativeEventFanAccessView");
  assert.match(fan, /if !sessionManagementOnly \{/);
  assert.match(fan, /await endLiveTaps\(\)/);
  assert.match(fan, /await recoverCelebration\(\)/);
  assert.doesNotMatch(read("NativeRecordMomentsView"), /NativeEventTrackingAccess|trackingAllowed/);
});
