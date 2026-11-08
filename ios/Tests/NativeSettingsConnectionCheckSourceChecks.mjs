import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");

test("Settings connection check makes a fresh authenticated read-only request", () => {
  const client = source("NativeAccountLinkClient.swift");
  const check = client.slice(client.indexOf("func checkAPIConnection"), client.indexOf("func getData"));
  assert.match(check, /notifications"\)\s*\.appendingPathComponent\("config"\)/);
  assert.match(check, /request\.httpMethod = "GET"/);
  assert.match(check, /Bearer \\\(token\)/);
  assert.match(check, /reloadIgnoringLocalCacheData/);
  assert.match(check, /forHTTPHeaderField: "Cache-Control"/);
  assert.doesNotMatch(check, /httpBody|postData|NativeOfflineRuntime\.shared\.deny/);
});

test("connection results distinguish sign-in, unreachable host, and server errors", () => {
  const client = source("NativeAccountLinkClient.swift");
  const runtime = source("NativeOfflineRuntime.swift");
  const check = client.slice(client.indexOf("func checkAPIConnection"), client.indexOf("func getData"));
  assert.match(check, /catch \{\s*return \.unreachable/);
  assert.match(check, /response\.statusCode == 401[\s\S]*?return \.signInRequired/);
  assert.match(check, /serverResponseError\(statusCode: response\.statusCode\)/);
  assert.match(runtime, /case connected/);
  assert.match(runtime, /case signInRequired/);
  assert.match(runtime, /case unreachable/);
  assert.match(runtime, /case serverResponseError\(statusCode: Int\)/);
});

test("Settings presents the connection result without exposing credentials", () => {
  const settings = source("NativeNotificationSettingsView.swift");
  assert.match(settings, /Button \{\s*Task \{ await model\.checkConnection\(clerk: clerk\) \}/);
  assert.match(settings, /native-settings-check-connection/);
  assert.match(settings, /native-settings-connection-result/);
  assert.match(settings, /result\.message/);
  assert.doesNotMatch(settings, /publishable key|session token|Bearer /i);
});
