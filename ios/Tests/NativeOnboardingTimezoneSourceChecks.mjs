import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");

test("iPhone onboarding detects a zone and offers a confirmation picker", () => {
  const view = source("NativeAthleteProfileView.swift");
  assert.match(view, /@State private var setupTimezone = TimeZone\.current\.identifier/);
  assert.match(view, /if isInitialSetup \{\s+Section\("Time zone"\)/);
  assert.match(view, /Picker\("Your time zone", selection: \$setupTimezone\)/);
  assert.match(view, /TimeZone\.knownTimeZoneIdentifiers \+ \[setupTimezone\]/);
  assert.match(view, /setupTimezone: isInitialSetup \? setupTimezone : nil/);
  assert.doesNotMatch(view, /CLLocationManager|requestWhenInUseAuthorization/);
});

test("the timezone is included only on the initial-setup profile request", () => {
  const api = source("SupporterHomeAPI.swift");
  assert.match(api, /var timezone: String\? = nil/);
  assert.match(api, /setupTimezone: String\? = nil/);
  assert.match(api, /timezone: completeSetup \? setupTimezone : nil/);
});

test("browser onboarding confirms the device zone and saves the assigned card's zone", () => {
  const app = readFileSync(new URL("../../artifacts/league-matrix-studio/src/App.tsx", import.meta.url), "utf8");
  const setup = app.slice(app.indexOf("export function RoleSelectionPage"));
  assert.match(setup, /getBrowserTimeZone\(\)/);
  assert.match(setup, /data-testid="input-profile-timezone"/);
  assert.match(setup, /getGameOnTimeZoneOptions\(setupTimezone\)/);
  assert.match(setup, /timezone: setupTimezone/);
  assert.match(setup, /timezone: assignedCard\.timezone \|\| setupTimezone/);
  const dashboard = readFileSync(new URL("../../artifacts/league-matrix-studio/src/features/supporter-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /timezone: resolveGameOnTimeZone\(savedFanCard\?\.timezone \?\? undefined\)/);
});
