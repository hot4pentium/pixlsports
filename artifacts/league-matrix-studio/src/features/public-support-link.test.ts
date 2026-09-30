import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readFeature = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const supportLinkSource = readFeature("public-support-link.tsx");
const hypeCardSource = readFeature("public-hype-card.tsx");
const eventCardSource = readFeature("game-on-card.tsx");
const spectatorSource = readFeature("stat-tracker-spectator.tsx");

test("public support email is a visible, keyboard-accessible, phone-friendly mail link", () => {
  assert.match(supportLinkSource, /href="mailto:support@pixlsports\.com"/);
  assert.match(supportLinkSource, />\s*support@pixlsports\.com\s*<\/a>/);
  assert.match(supportLinkSource, /aria-label="Email Pixl Sports support at support@pixlsports\.com"/);
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