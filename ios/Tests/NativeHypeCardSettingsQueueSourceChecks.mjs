import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) =>
  readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const view = read("SupporterHypeCardView.swift");
const client = read("NativeAccountLinkClient.swift");
const runtime = read("NativeOfflineRuntime.swift");
const api = read("SupporterHomeAPI.swift");
const uiTest = readFileSync(new URL("../UITests/NativeHypeCardOfflineUITests.swift", import.meta.url), "utf8");

test("visibility uses one explicit Public / Private choice without normalizing on load", () => {
  assert.match(view, /Toggle\(isOn: publicVisibilityBinding\)/);
  assert.match(view, /Text\("Public \/ Private"\)/);
  assert.doesNotMatch(view, /Toggle\("(Show HYPE Card|Pause public page)"/);
  const binding = view.slice(view.indexOf("private var publicVisibilityBinding"), view.indexOf("private var showStatsBinding"));
  assert.match(binding, /get: \{ draftShowHypeCard && !draftPaused \}/);
  assert.match(binding, /draftShowHypeCard = \$0[\s\S]*?draftPaused = !\$0[\s\S]*?persistSettingsDraft/);
  assert.match(view, /draftShowHypeCard = saved\.showHypeCard/);
  assert.match(view, /draftPaused = saved\.paused/);
  assert.match(view, /if becomesPublic \{[\s\S]*?showPublishConfirmation = true/);
  for (const source of [view, api]) {
    assert.match(source, /let visibilityEdited = !localHasKnownBase[\s\S]*?local\.showHypeCard != base\.showHypeCard \|\| local\.paused != base\.paused/);
    assert.match(source, /showHypeCard: visibilityEdited[\s\S]*?paused: visibilityEdited/);
  }
});

test("only an explicit Save creates an automatically syncable settings intent", () => {
  const draftPersistence = view.slice(
    view.indexOf("private func persistSettingsDraft()"),
    view.indexOf("private func requestSettingsSave()")
  );
  assert.match(draftPersistence, /saveHypeCardSettingsDraft/);
  assert.doesNotMatch(draftPersistence, /saveHypeCardSettingsSaveIntent|queueHypeCardSettingsSave/);

  const explicitSave = view.slice(
    view.indexOf("private func saveSettings(confirmPublish:"),
    view.indexOf("private func syncQueuedSettings")
  );
  assert.match(explicitSave, /queueHypeCardSettingsSave/);
  assert.match(client, /intent\.desired\.hasSameSettings\(as: draft\)/);
  assert.match(client, /saveHypeCardSettingsDraft\(draft, subject: subject\)[\s\S]*?saveHypeCardSettingsSaveIntent\(intent, subject: subject\)/);
});

test("reconnect and relaunch processing reads only queued saves and revalidates account scope", () => {
  assert.match(runtime, /verifiedSchedule\(clerk: clerk\)[\s\S]*?syncPendingHypeCardSettings\(clerk: clerk\)/);
  assert.equal(
    (runtime.match(/syncPendingHypeCardSettings\(clerk: clerk\)/g) ?? []).length,
    2,
    "The runtime checks once after reconnect and again during its retry rounds."
  );
  assert.match(runtime, /loadHypeCardSettingsSaveIntent\(subject: subject\)/);
  assert.match(runtime, /SupporterHomeAPI\.syncQueuedNativeHypeCardSettings\(clerk: clerk\)/);
  assert.match(runtime, /vault\.namespace == scope/);
  assert.match(api, /loadHypeCardSettingsSaveIntent\(subject: subject\)/);
  assert.match(api, /fetchAuthoritativeNativeHypeCardSettings\(clerk: clerk\)/);
  assert.match(api, /expectedRevision: revision/);
});

test("uncertain responses and conflicts retain the queued intent for later reconciliation", () => {
  assert.match(api, /if latest\.hasSameSettings\(as: intent\.desired\)/);
  assert.match(api, /catch let error as NativeAccountLinkError where error\.statusCode == 409/);
  assert.match(api, /clearHypeCardSettingsConfirmation\(subject: subject\)/);
  assert.match(api, /confirmPublish: intent\.confirmPublish/);
  const completion = api.slice(
    api.indexOf("private static func finishQueuedNativeHypeCardSettings"),
    api.indexOf("private static func mergeQueuedHypeCardSettings")
  );
  assert.ok(
    completion.indexOf("clearHypeCardSettingsSaveIntent") > completion.indexOf("clearHypeCardSettingsDraft"),
    "The queue remains durable until confirmation and draft cleanup have completed."
  );
});

test("the Apple UI test exercises an independent remote write and keeps the editor-only value hidden", () => {
  const uiTestAPI = api.slice(
    api.indexOf("static func applyNativeHypeCardConflictEditForUITest"),
    api.indexOf("static func syncQueuedNativeHypeCardSettings"),
  );
  assert.match(uiTestAPI, /fetchAuthoritativeNativeHypeCardSettings/);
  assert.match(uiTestAPI, /showEvents: !latest\.showEvents/);
  assert.match(uiTestAPI, /favoriteMoment: latest\.favoriteMoment/);
  assert.match(uiTestAPI, /expectedRevision: revision/);
  assert.match(view, /--ui-testing-hype-card-settings-conflict/);
  assert.match(view, /applyNativeHypeCardConflictEditForUITest/);
  assert.match(uiTest, /testReopenedCardMergesRemoteOnlyAndLocallyEditedSettings/);
  assert.match(uiTest, /native-hype-card-favorite-moment/);
  assert.match(uiTest, /XCTAssertEqual\([\s\S]*?localStats/);
  assert.match(uiTest, /XCTAssertEqual\([\s\S]*?remoteEvents/);
});

test("removing the HYPE Card input preserves legacy saved values", () => {
  assert.doesNotMatch(view, /TextField\(\s*"Favorite moment"|native-hype-card-favorite-moment/);
  assert.match(view, /favoriteMoment: favorite\.isEmpty \? nil : favorite/);
  assert.match(view, /draftFavoriteMoment = saved\.favoriteMoment \?\? ""/);
  assert.match(view, /favoriteMoment: !localHasKnownBase \|\| local\.favoriteMoment != base\.favoriteMoment[\s\S]*?latest\.favoriteMoment/);
});
