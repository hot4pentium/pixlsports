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
  assert.match(source, /trackEvent\('hype_card_stats_viewed'/);
  assert.match(source, /media_type: share\.mediaType/);
  assert.match(source, /Published finalized totals/);
  assert.match(source, /data-testid="hype-card-recipient-game-summaries"/);
  assert.match(source, /data-testid="hype-card-recipient-game-summary"/);
  assert.match(source, /Finalized games/);
  assert.match(source, /Game-by-game summaries are not available/);
  assert.match(source, /data-testid="hype-card-recipient-stats-unavailable"/);
  assert.match(source, /Stats were not attached to this Hype Card/);
});