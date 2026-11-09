import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const association = JSON.parse(read("../../artifacts/league-matrix-studio/public/.well-known/apple-app-site-association"));
const app = read("../PIXL Sports/MyApp.swift");
const parser = read("../PIXL Sports/NativeHypeCardUniversalLink.swift");
const recipient = read("../PIXL Sports/NativePublicHypeCardRecipientView.swift");
const card = read("../PIXL Sports/SupporterHypeCardView.swift");
const api = read("../PIXL Sports/SupporterHomeAPI.swift");
const client = read("../PIXL Sports/NativeAccountLinkClient.swift");
const entitlements = read("../PIXL Sports/PIXL Sports.entitlements");
const project = read("../PIXL Sports.xcodeproj/project.pbxproj");
const replit = read("../../.replit");
const webApp = read("../../artifacts/league-matrix-studio/src/App.tsx");
const home = read("../PIXL Sports/ContentView.swift");

test("the published host associates the HYPE Card route with the iOS app", () => {
  assert.deepEqual(association.applinks.details[0].appIDs, ["4A3BQUR9MQ.com.pixlsports"]);
  assert.deepEqual(association.applinks.details[0].components[0]["/"], "/fan/*");
  assert.match(entitlements, /applinks:pixlsports\.com/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.pixlsports;/);
  assert.match(project, /DEVELOPMENT_TEAM = 4A3BQUR9MQ;/);
  assert.match(replit, /\[\[deployment\.responseHeaders\]\][\s\S]*?path = "\/\.well-known\/apple-app-site-association"[\s\S]*?name = "Content-Type"[\s\S]*?value = "application\/json"/);
});

test("native deep links accept only HTTPS fan links on the configured host", () => {
  assert.match(app, /\.onOpenURL\(perform: handleIncomingURL\)/);
  assert.match(app, /NativeHypeCardUniversalLink\.inviteToken\(from: url, allowedOrigin: origin\)/);
  assert.match(parser, /components\.scheme\?\.lowercased\(\) == "https"/);
  assert.match(parser, /components\.host\?\.lowercased\(\) == allowedHost/);
  assert.match(parser, /components\.percentEncodedPath/);
  assert.match(parser, /\^\[A-Za-z0-9_-\]\{1,128\}\$/);
});

test("recipient loading is public, read-only, and leaves browser fallback in place", () => {
  assert.match(recipient, /SupporterHypeCardView\(clerk: nil, publicInviteToken: inviteToken\)/);
  assert.match(api, /static func fetchPublicHypeCard\(inviteToken: String\)/);
  assert.match(api, /client\.publicRequest\("athlete-invites\/\\\(inviteToken\)\/fan"\)/);
  assert.match(client, /NativeAccountLinkError\.serverStatus\(response\.statusCode, failure\.error\)/);
  assert.match(card, /if !isPublicRecipient, settings != nil/);
  assert.match(card, /if isPublicRecipient \{/);
  assert.match(webApp, /path="\/fan\/:inviteToken" component=\{LivingAthleteCardRoute\}/);
});

test("athlete details shortcut opens the existing editor only on the owner card", () => {
  assert.match(card, /publicCardContent\(card\)\s*editAthleteDetailsButton/);
  assert.match(card, /private var editAthleteDetailsButton: some View/);
  assert.match(home, /\.hypeCard:[\s\S]*?showsAthleteDetailsShortcut: true/);
  assert.match(card, /if showsAthleteDetailsShortcut, !isPublicRecipient, let clerk, settings != nil/);
  assert.match(card, /NativeAthleteProfileView\(clerk: clerk, onSaved: \{ athleteProfile = \$0 \}\)/);
  assert.match(card, /native-hype-card-edit-athlete-details/);
  assert.match(card, /Edit these details here or in Settings/);
});
