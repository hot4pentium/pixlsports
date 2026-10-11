import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readFeature = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const supportLinkSource = readFeature("public-support-link.tsx");
const hypeCardSource = readFeature("public-hype-card.tsx");
const eventCardSource = readFeature("game-on-card.tsx");
const spectatorSource = readFeature("stat-tracker-spectator.tsx");

test("public support is a visible, keyboard-accessible, phone-friendly help desk link", () => {
  assert.match(supportLinkSource, /href="\/help"/);
  assert.match(supportLinkSource, /Open the help desk/);
  assert.match(supportLinkSource, /aria-label="Open Pixl Sports help"/);
  assert.doesNotMatch(supportLinkSource, /mailto:support@pixlsports\.com/);
  assert.match(supportLinkSource, /min-h-11/);
  assert.match(supportLinkSource, /focus-visible:outline/);
  assert.doesNotMatch(supportLinkSource, /\bhidden\b/);
});

test("shared Hype Card, Event Card, and spectator stat page shells include support", () => {
  for (const [page, source] of [
    ["Hype Card", hypeCardSource],
    ["Event Card", eventCardSource],
    ["spectator stats", spectatorSource],
  ] as const) {
    const supportLinks = source.match(/<PublicSupportLink\b/g) ?? [];
    assert.ok(supportLinks.length >= 3, `${page} should show support on loading, unavailable, and shared views`);
  }
});