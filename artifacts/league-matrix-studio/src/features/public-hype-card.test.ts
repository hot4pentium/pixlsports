import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./public-hype-card.tsx', import.meta.url), 'utf8');

test('recipient Hype Cards keep the card visible while exposing expandable athlete stats', () => {
  assert.match(source, /data-testid="hype-card-recipient-stats"/);
  assert.match(source, /data-testid="button-view-hype-card-stats"/);
  assert.match(source, /aria-expanded=\{showStats\}/);
  assert.match(source, /aria-controls="hype-card-recipient-stats-details"/);
  assert.match(source, /View athlete stats/);
  assert.match(source, /Published finalized totals/);
  assert.match(source, /data-testid="hype-card-recipient-stats-unavailable"/);
  assert.match(source, /Stats were not attached to this Hype Card/);
});