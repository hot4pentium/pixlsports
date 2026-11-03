import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Cheap structural guards only. Actual first paint requires the normal-launch
// XCTest and a physical-device run; these checks do not execute SwiftUI/Clerk.
const root = readFileSync(new URL("../PIXL Sports/NativeAuthRootView.swift", import.meta.url), "utf8");
const withoutComments = root.replace(/\/\/[^\n]*/g, "");
const authBody = withoutComments.slice(
  withoutComments.indexOf("var body: some View"),
  withoutComments.indexOf(".onChange(of: offline.online)"),
);
const splash = withoutComments.slice(withoutComments.indexOf("struct NativeLaunchSplashView"));

test("authentication root does not wrap child navigation in another stack or scroll viewport", () => {
  assert.ok(authBody.includes("ContentView("));
  assert.ok(authBody.includes("AuthView(isDismissible: false)"));
  assert.doesNotMatch(authBody, /\b(?:NavigationStack|GeometryReader|ScrollView)\s*[{(]/);
  assert.match(authBody, /accessibilityIdentifier\("native-sign-in-screen"\)/);
});

test("first-paint splash centers without observing geometry", () => {
  assert.doesNotMatch(splash, /\bGeometryReader\s*[{(]/);
  assert.doesNotMatch(splash, /\.position\s*\(/);
  assert.match(splash, /NativePageBackground\(\)/);
  assert.match(splash, /reduceMotion/);
  assert.match(splash, /native-launch-retry/);
});
