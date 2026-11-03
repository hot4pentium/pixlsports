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
  assert.ok(authBody.includes("NativeClerkSignInForm()"));
  assert.doesNotMatch(authBody, /\bAuthView\(/);
  assert.doesNotMatch(authBody, /\b(?:NavigationStack|GeometryReader|ScrollView)\s*[{(]/);
  assert.match(authBody, /accessibilityIdentifier\("native-sign-in-screen"\)/);
});

test("Clerk form construction has a stable observation boundary and theme", () => {
  const form = withoutComments.slice(
    withoutComments.indexOf("struct NativeClerkSignInForm"),
    withoutComments.indexOf("struct NativeLaunchSplashView"),
  );
  assert.match(form, /AuthView\(isDismissible: false\)/);
  assert.match(form, /private static let theme: ClerkTheme/);
  assert.doesNotMatch(form, /@(?:AppStorage|ObservedObject|Environment)\b/);
  assert.match(authBody, /NativeClerkSignInForm\(\)\s*\.id\(authPresentationID\)/);
});

test("first-paint splash centers without observing geometry", () => {
  assert.doesNotMatch(splash, /\bGeometryReader\s*[{(]/);
  assert.doesNotMatch(splash, /\.position\s*\(/);
  assert.match(splash, /NativePageBackground\(\)/);
  assert.match(splash, /reduceMotion/);
  assert.match(splash, /native-launch-retry/);
});

test("startup diagnostic preserves Clerk configuration and normal authorization", () => {
  const app = readFileSync(new URL("../PIXL Sports/MyApp.swift", import.meta.url), "utf8");
  const probe = readFileSync(new URL("../PIXL Sports/NativeStartupDiagnosticView.swift", import.meta.url), "utf8");
  const initialization = app.slice(app.indexOf("init()"), app.indexOf("var body: some Scene"));
  assert.doesNotMatch(initialization, /--diagnose-startup/);
  assert.match(initialization, /Clerk\.configure\(/);
  assert.match(app, /#if DEBUG\s+if ProcessInfo\.processInfo\.arguments\.contains\("--diagnose-startup"\)/);
  assert.match(probe, /^#if DEBUG &&/);
  assert.match(probe, /case \.app:\s*\/\/[^\n]*\n\s*NativeAuthRootView\(\)/);
  assert.doesNotMatch(probe, /signOut\(|\.clear\(|\.removeItem|\.getToken\(/);
  const initialBody = probe.slice(probe.indexOf("var body:"), probe.indexOf("private func select"));
  assert.doesNotMatch(initialBody, /clerk\.(isLoaded|user|session|isAuthFlowComplete)/);
});
