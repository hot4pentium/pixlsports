import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) =>
  readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const api = read("SupporterHomeAPI.swift");
const linkModel = read("NativeAccountLinkModel.swift");
const app = read("MyApp.swift");
const uiTest = readFileSync(
  new URL("../UITests/NativeHypeCardOfflineUITests.swift", import.meta.url),
  "utf8",
);

test("a confirmed unlinked owner-card response clears the offline vault", () => {
  const unlinkedBranch = api.slice(
    api.indexOf('if reference.status == "unlinked"'),
    api.indexOf('guard reference.status == "no-card"'),
  );
  assert.match(unlinkedBranch, /try offline\.clear\(\)/);
  assert.doesNotMatch(unlinkedBranch, /privateCard: reference|privatePhoto: reference|settings: reference/);
});

test("the native disconnect flow clears local private data after server confirmation", () => {
  const disconnect = linkModel.slice(
    linkModel.indexOf("func disconnect(clerk: Clerk)"),
    linkModel.indexOf("private func perform(", linkModel.indexOf("func disconnect(clerk: Clerk)")),
  );
  assert.match(disconnect, /client\.request\(method: "DELETE", clerk: clerk\)/);
  assert.match(disconnect, /state\?\.status == "unlinked"[\s\S]*?NativeOfflineRuntime\.shared\.clear\(\)/);
  assert.match(linkModel, /disconnectRemotelyForOfflineRevocationUITest[\s\S]*?clearOfflineData: false/);
});

test("the Apple test disconnects a real link and verifies offline data stays hidden", () => {
  assert.match(app, /--ui-testing-account-link[\s\S]*?NativeAccountLinkView\(\)/);
  const test = uiTest.slice(
    uiTest.indexOf("func testRevokedLinkCannotRestoreHiddenOwnerCardOffline()"),
  );
  assert.match(test, /requireVisibility\("hidden"\)/);
  assert.match(test, /native-hype-card-toggle-stats/);
  assert.match(test, /native-account-link-disconnect/);
  assert.match(test, /--ui-testing-preserve-offline-vault/);
  assert.match(test, /dashboard-connection-action/);
  assert.match(test, /--ui-testing-force-offline/);
  assert.match(test, /Connect to get ready/);
  assert.match(test, /native-hype-card-private-preview/);
  assert.match(test, /native-hype-card-owner-settings/);
});
