import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.doesNotMatch(splash, /NativePageBackground\(\)/);
  assert.match(splash, /Color\.white\.ignoresSafeArea\(\)/);
  assert.match(splash, /Image\("PixlSportsLogo"\)/);
  assert.match(splash, /reduceMotion/);
  assert.match(splash, /native-launch-retry/);
  const assets = new URL("../PIXL Sports/Assets.xcassets/", import.meta.url);
  assert.ok(existsSync(new URL("PixlSportsLogo.imageset/pixlsports-logo.png", assets)));
  assert.ok(existsSync(new URL("PixlSportsLogoOnDark.imageset/pixlsports-logo-on-dark.png", assets)));
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

test("routine Prep saves do not insert a changing status panel", () => {
  const prep = readFileSync(new URL("../PIXL Sports/NativeEventPrepView.swift", import.meta.url), "utf8");
  assert.match(prep, /private var shouldShowSaveNotice: Bool/);
  assert.match(prep, /model\.errorMessage != nil \|\| model\.conflictBlocked \|\| model\.unreadablePendingData \|\| !offline\.online/);
  assert.equal((prep.match(/if let clerk, shouldShowSaveNotice/g) || []).length, 2);
  assert.match(prep, /Text\(saveStatusText\)[\s\S]*?\.frame\(minHeight: 16, alignment: \.leading\)/);
});

test("long-press edit updates the selected Prep task in place", () => {
  const prep = readFileSync(new URL("../PIXL Sports/NativeEventPrepView.swift", import.meta.url), "utf8");
  assert.match(prep, /\.contextMenu\s*\{\s*Button\s*\{\s*beginEditingTask\(item\)\s*\}\s*label:\s*\{\s*Label\("Edit task", systemImage: "pencil"\)/);
  const editBlock = prep.slice(prep.indexOf("private func saveTaskEntry()"), prep.indexOf("private func beginEditingTask"));
  assert.match(editBlock, /items\[index\]\.label = label[\s\S]*?scheduleChecklistAutosave\(\)/);
  assert.doesNotMatch(editBlock, /items\[index\]\s*=\s*NativePrepItem/);
  assert.match(prep, /Button\(action: saveTaskEntry\)/);
  assert.doesNotMatch(prep, /\baddTask\(/);
  assert.match(prep, /Label\(editingTaskID == nil \? "Add" : "Update"/);
});

test("Event Card editing is hidden while Prep is selected", () => {
  const detail = readFileSync(new URL("../PIXL Sports/SupporterEventDetailView.swift", import.meta.url), "utf8");
  assert.match(detail, /if let clerk, selectedStep != \.prep\s*\{\s*NavigationLink/);
  assert.match(detail, /accessibilityIdentifier\("event-detail-edit"\)/);
});

test("dashboard header uses the white Sports logo on its dark panel", () => {
  const content = readFileSync(new URL("../PIXL Sports/ContentView.swift", import.meta.url), "utf8");
  const start = content.indexOf("private var header: some View");
  const end = content.indexOf("private var ", start + 1);
  const dashboardHeader = content.slice(start, end);
  assert.match(dashboardHeader, /Image\("PixlSportsLogoOnDark"\)/);
});

test("dashboard message board labels the green action as the next step", () => {
  const hero = readFileSync(new URL("../PIXL Sports/NativeHomeHeroCards.swift", import.meta.url), "utf8");
  const nextStep = hero.indexOf('Text("Next Step")');
  const greenAction = hero.indexOf(".background(SupporterHomeColors.accent, in: Capsule())");
  assert.ok(nextStep >= 0 && greenAction > nextStep, "Next Step must appear before the green action.");
  assert.match(hero, /Next step: \\\(timingTitle\.lowercased\(\)\)/);
});

test("expired games do not keep the Up Next label from future Event Cards", () => {
  const homeModel = readFileSync(new URL("../PIXL Sports/SupporterHomeViewModel.swift", import.meta.url), "utf8");
  const content = readFileSync(new URL("../PIXL Sports/ContentView.swift", import.meta.url), "utf8");
  assert.match(homeModel, /guard let recommendation = NativeEventGuideTiming\.gameRecommendation\([\s\S]*?now: now\s*\) else \{\s*return nil\s*\}/);
  assert.match(content, /let nextUpcomingID = events\.first\(where: \{ \$0\.timing == \.upcoming \}\)\?\.id/);
});

test("passed Event Cards stay in the season list without an age cutoff", () => {
  const homeModel = readFileSync(new URL("../PIXL Sports/SupporterHomeViewModel.swift", import.meta.url), "utf8");
  const content = readFileSync(new URL("../PIXL Sports/ContentView.swift", import.meta.url), "utf8");
  const pastCards = homeModel.slice(homeModel.indexOf("private func pastEventCards"));
  assert.match(pastCards, /guard event\.date <= today else \{ return nil \}/);
  assert.doesNotMatch(pastCards, /\bcutoff\b|30 \* 24/);
  assert.doesNotMatch(homeModel, /guard event\.status != "final" else \{ return nil \}/);
  assert.match(content, /let allEventCards = events \+ pastEvents/);
});

test("HYPE Card and photo screens do not show raw server errors", () => {
  const photo = readFileSync(new URL("../PIXL Sports/NativeAthletePhotoSection.swift", import.meta.url), "utf8");
  const hypeCard = readFileSync(new URL("../PIXL Sports/SupporterHypeCardView.swift", import.meta.url), "utf8");
  assert.doesNotMatch(photo, /error\.localizedDescription/);
  assert.match(photo, /Your HYPE Card hasn’t changed\. Photo details couldn’t load right now\./);
  assert.match(photo, /Button\("Refresh photo"\)/);
  assert.match(photo, /NavigationLink\("Review HYPE Card"\)/);
  assert.doesNotMatch(hypeCard, /error\.localizedDescription/);
  assert.match(hypeCard, /We couldn’t load your HYPE Card right now\. Please try again\./);
  assert.match(hypeCard, /We couldn’t confirm that your HYPE Card settings were saved\. Your choices are still here\. Check saved status when you can\./);
});

test("HYPE Card photo fills its frame and section tabs attach below a flipping face", () => {
  const front = readFileSync(new URL("../PIXL Sports/NativeHypeCardFront.swift", import.meta.url), "utf8");
  const hypeCard = readFileSync(new URL("../PIXL Sports/SupporterHypeCardView.swift", import.meta.url), "utf8");
  const publicContentStart = hypeCard.indexOf("private func publicCardContent");
  const frontFacePosition = hypeCard.indexOf("frontCardFace(card)", publicContentStart);
  const tabsPosition = hypeCard.indexOf("cardSectionTabs", frontFacePosition);
  assert.match(front, /\.scaledToFill\(\)/);
  assert.match(front, /\.clipped\(\)/);
  assert.match(hypeCard, /rotation3DEffect\(/);
  assert.match(hypeCard, /cardRotation - 180/);
  assert.ok(frontFacePosition >= 0 && tabsPosition > frontFacePosition,
            "The selector is placed after the card face in the connected card layout.");
  assert.match(hypeCard, /native-hype-card-flip-container/);
  assert.match(hypeCard, /selectCardSide\(side\)/);
});

test("Settings alert failures use plain language without exposing server details", () => {
  const client = readFileSync(new URL("../PIXL Sports/NativeAccountLinkClient.swift", import.meta.url), "utf8");
  const copy = client.slice(client.indexOf("private static func requestFailureMessage"), client.indexOf("static func apiOrigin"));
  assert.match(copy, /notifications\/subscriptions/);
  assert.match(copy, /Alerts on this iPhone couldn’t be connected right now\. Please try again\./);
  assert.match(copy, /Your alert settings couldn’t be loaded right now\. Please try again\./);
  assert.match(copy, /We couldn’t confirm that your HYPE Card settings were saved\. Please check and try again if needed\./);
  assert.doesNotMatch(client, /The Event Card request failed on|schedule request failed on|redirected the request \(HTTP/);
  assert.match(client, /if response\.statusCode < 500/);
});

test("dashboard does not show the large offline status card", () => {
  const content = readFileSync(new URL("../PIXL Sports/ContentView.swift", import.meta.url), "utf8");
  assert.doesNotMatch(content, /NativeOfflineStatusView\s*\{/);
});

test("Prep save conflicts use simple copy and confirm before replacing local changes", () => {
  const tools = readFileSync(new URL("../PIXL Sports/NativeEventTools.swift", import.meta.url), "utf8");
  const prep = readFileSync(new URL("../PIXL Sports/NativeEventPrepView.swift", import.meta.url), "utf8");
  const notice = tools.slice(tools.indexOf("struct NativeToolSaveNotice: View"));
  const pendingDescription = tools.slice(tools.indexOf("var pendingDescription"), tools.indexOf("var ownsCurrentScope"));
  assert.match(prep, /hasUnsavedChanges: edited,\s*savedContentName: "Prep"/);
  assert.match(notice, /Your Prep update wasn't saved\. It's still on this iPhone\./);
  const savedAction = 'Button("Use saved \\(savedContentName)", role: .destructive)';
  assert.ok(notice.includes(savedAction));
  assert.ok(notice.includes('Button("Keep this Prep")'));
  assert.ok(notice.includes('Button("Replace saved Prep", role: .destructive)'));
  assert.ok(notice.includes("The saved Prep list will be replaced with the one on this iPhone."));
  assert.ok(notice.includes("Task { await onKeepLocalPrep?() }"));
  assert.ok(notice.includes('confirmingRecovery == .keepLocalPrep\n                ? "Replace saved Prep?"\n                : "Use saved \\(savedContentName) instead?"'));
  assert.match(notice, /Changes not saved yet will be removed from this iPhone\. The saved copy will stay\./);
  assert.ok(notice.indexOf("await model.discardAndReload(clerk: clerk)") > notice.indexOf(".confirmationDialog("));
  assert.ok(notice.includes("model.canKeepLocalPrep"));
  assert.ok(prep.includes('onKeepLocalPrep: { await keepLocalPrepChanges() }'));
  assert.match(prep, /await model\.keepLocalPrep\(clerk: clerk, items: items, notes: notes, notesDirty: notesDirty\)/);
  assert.doesNotMatch(notice, /waiting to sync|Use PIXL version|changed elsewhere|server version|revision/);
  assert.doesNotMatch(pendingDescription, /PIXL|sync|revision/);
  assert.match(pendingDescription, /still need/);
  assert.doesNotMatch(prep, /Needs attention|not yet saved to PIXL|waiting to sync/);
  assert.match(prep, /if model\.workspace != nil && !shouldShowSaveNotice \{ saveFooter \}/);
  assert.match(prep, /if !embedded && model\.workspace != nil && !shouldShowSaveNotice \{\s*saveFooter\s*\}/);
});
