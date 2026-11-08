import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const content = read("ContentView.swift");
const hero = read("NativeHomeHeroCards.swift");
const fanBase = read("NativeSeasonRecordView.swift");

test("the compact Fan Base entry is centered below the HYPE Card", () => {
  const hypeStart = hero.indexOf("Button(action: onOpenHypeCard)");
  const entryStart = hero.indexOf("Button(action: onOpenFanBase)");
  assert.ok(hypeStart >= 0 && entryStart > hypeStart);
  assert.match(hero.slice(entryStart), /NativeFanBaseEntryView[\s\S]*?dashboard-fan-base-entry[\s\S]*?frame\(maxWidth: \.infinity, alignment: \.center\)/);
  const entry = fanBase.slice(fanBase.indexOf("struct NativeFanBaseEntryView"), fanBase.indexOf("struct NativeFanBaseView:"));
  assert.match(entry, /maxWidth: 160, minHeight: 44/);
  assert.match(entry, /Text\("Fan Base"\)/);
  assert.match(entry, /\.lineLimit\(1\)/);
  assert.equal((entry.match(/Text\(/g) ?? []).length, 1);
  assert.doesNotMatch(entry, /Image\(|FOLLOWS|Loading|View details|namedFans|anonymousFollows/);
  assert.match(content, /onOpenFanBase: \{ heroDestination = \.fanBase \}/);
});

test("the destination preserves all Fan Base details and retry states", () => {
  const page = content.slice(content.indexOf("private var fanBasePage"), content.indexOf("private var athleteHero"));
  assert.match(content, /case \.fanBase:\s*fanBasePage/);
  assert.match(page, /ScrollView/);
  assert.match(page, /NativeFanBaseView\(fanBase: fanBase\)/);
  assert.match(page, /NativeFanBaseStatusView/);
  assert.match(page, /fanBaseRefreshFixture\.retry\(\)/);
  assert.match(page, /await loadSchedule\(\)/);
  assert.match(page, /refreshable \{ await refreshDashboard\(\) \}/);
  const dashboard = content.slice(content.indexOf("var body: some View"), content.indexOf(".fullScreenCover(item: $heroDestination"));
  assert.doesNotMatch(dashboard, /NativeFanBaseView\(|NativeFanBaseStatusView\(/);
  assert.match(fanBase, /Follows are from devices; names are self-entered/);
});
