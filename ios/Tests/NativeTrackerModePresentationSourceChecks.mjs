import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../PIXL Sports/NativeEventTrackerView.swift", import.meta.url), "utf8");
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("athlete and team have named, selected mode controls and distinct styling", () => {
  assert.match(source, /case athlete, team, opponent/);
  assert.match(source, /case \.athlete: return NativeEventToolColors\.trackStats/);
  assert.match(source, /case \.team: return NativeEventToolColors\.prep/);
  assert.match(source, /case \.athlete: return "person\.fill"/);
  assert.match(source, /case \.team: return "person\.3\.fill"/);
  const picker = between("private var modePicker:", "private var modeBanner:");
  assert.match(picker, /modeChoice\(\.athlete, value: "athlete", name: athleteName\)/);
  assert.match(picker, /modeChoice\(\.team, value: "team", name: teamName\)/);
  assert.match(picker, /Button \{ attribution = value \}/);
  assert.match(picker, /accessibilityAddTraits\(selected \? \.isSelected : \[\]\)/);
  assert.match(picker, /native-event-tracker-mode-/);
  assert.doesNotMatch(picker, /model\.save|withAnimation/);
});

test("mode identity is repeated in the banner and tiles without color-only cues", () => {
  assert.match(source, /Text\("TRACKING \\\(mode\.title\.uppercased\(\)\)"/);
  assert.match(source, /native-event-tracker-mode-banner-/);
  assert.match(source, /native-event-stat-tile-/);
  assert.match(source, /mode == \.athlete \? mode\.color\.opacity\(0\.16\) : mode\.color\.opacity\(0\.05\)/);
  assert.match(source, /lineWidth: mode == \.athlete \? 0 : 1\.5/);
  assert.match(source, /Text\(mode\.title\.uppercased\(\)\)/);
  assert.match(source, /accessibilityHint\(trackerMode\.title \+ " mode"\)/);
});

test("the shared scoreboard and existing totals remain explicitly labelled", () => {
  assert.match(source, /Text\("TEAM SCOREBOARD"\)/);
  assert.match(source, /scoreboard\(teamName, score: game\.score/);
  assert.match(source, /score: game\.opponentScore, opponent: true/);
  assert.match(source, /Text\(mode == \.opponent \? "opponent total" : "team total"\)/);
  assert.match(source, /Text\("\\\(athleteCount\(game: game, statID: statID\)\) by \\\(athleteName\)"\)/);
  assert.match(source, /let total = statTotal\(game: game, statID: statID\)/);
  assert.match(source, /game\.events\.filter \{ \$0\.statId == statID && \$0\.attribution == "athlete" && \$0\.possessionSide != "opponent" \}\.count/);
  assert.match(source, /opponentPossession \? game\.opponentStats\?\[statID\] \?\? 0 : game\.stats\[statID\] \?\? 0/);
});

test("presentation changes preserve stat writes, opponent ownership and editing guards", () => {
  assert.match(source, /model\.save\("stat", clerk: clerk, statID: stat\.id,\s*athlete: attribution == "athlete", opponent: opponentPossession, yards: yards\)/);
  assert.match(source, /opponentPossession \? \.opponent : \(attribution == "athlete" \? \.athlete : \.team\)/);
  assert.match(source, /\.disabled\(opponentPossession\)/);
  assert.match(source, /case \.opponent: return opponent/);
  assert.match(source, /\.disabled\(!model\.canQueueStat\)/);
  assert.match(source, /let canEditScore = game\.status == "live" && model\.canEditTrackerLocally/);
  assert.match(source, /if !compact \{\s*if game\.sport == "football"/);
});

test("selected-mode text uses dark ink with accessible contrast on both accent fills", () => {
  assert.match(source, /modeSelectionInk: Color \{ Color\(red: 0\.06, green: 0\.10, blue: 0\.18\) \}/);
  assert.match(source, /foregroundStyle\(selected \? modeSelectionInk : Color\.primary\)/);
  const luminance = (rgb) => rgb.map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const colors = readFileSync(new URL("../PIXL Sports/SupporterHomeComponents.swift", import.meta.url), "utf8");
  for (const name of ["trackStats", "prep"]) {
    const match = colors.match(new RegExp(`static let ${name} = Color\\(red: ([\\d.]+), green: ([\\d.]+), blue: ([\\d.]+)\\)`));
    assert.ok(match, `${name} uses a known accent`);
    const ratio = (luminance(match.slice(1).map(Number)) + 0.05) / (luminance([0.06, 0.10, 0.18]) + 0.05);
    assert.ok(ratio >= 4.5, `${name} contrast ${ratio.toFixed(2)} must exceed 4.5:1`);
  }
});
