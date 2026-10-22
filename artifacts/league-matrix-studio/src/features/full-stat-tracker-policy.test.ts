import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { addStatEvent, createGameSession, endGame, getSportRule, normalizeTrackerData, trackerPayload, undoLastStatEvent } from './stat-tracker';
import { buildWorkspaceToolHref } from './workspace-context';

test('all requested soccer stats are visible by default and survive undo, save, and reload', () => {
  const ids = ['corner-kick', 'penalty-kick', 'red-card'];
  const rule = getSportRule('soccer');
  let game = createGameSession('soccer', { opponent: 'Northside', soccerPeriodFormat: 'halves' });
  for (const id of ids) {
    assert.ok(rule.stats.find((stat) => stat.id === id)?.featured, `${id} must be visible without Show all stats`);
    game = addStatEvent(game, id, new Date(), 0, 'team');
    game = addStatEvent(game, id, new Date(), 0, 'athlete');
  }
  assert.equal(game.score, 0, 'kicks and cards are not automatically goals');
  assert.equal(game.events.length, 6);
  const undone = undoLastStatEvent(game);
  assert.equal(undone.stats['red-card'], 1);
  assert.equal(game.stats['red-card'], 2);
  const restored = normalizeTrackerData(JSON.parse(JSON.stringify(trackerPayload({ version: 1, games: [endGame(game)] })))).games[0];
  for (const id of ids) {
    assert.equal(restored.stats[id], 2);
    assert.equal(restored.events.filter((event) => event.statId === id && event.attribution === 'athlete').length, 1);
  }
});

test('the full tracker is the sole production tracking surface', () => {
  const page = readFileSync(new URL('./stat-tracker-page.tsx', import.meta.url), 'utf8');
  const collection = readFileSync(new URL('./game-on-dashboard-collection.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /<AthleteResultPanel\b|showAdvancedSetup|setShowAdvancedSetup/);
  assert.match(page, /<StatTrackerStartPanel/);
  assert.match(page, /<LiveTrackerGame/);
  assert.doesNotMatch(collection, /import.*GameOnInlineStatTracker|<GameOnInlineStatTracker/);
  assert.match(collection, /panel === 'tracker'[\s\S]*setLocation\(buildWorkspaceToolHref\('stats'/);
});

test('Event Card tracking links preserve the full tracker game context', () => {
  const event = { id: 'event/soccer', type: 'game' as const, date: '2026-10-22', time: '18:00', location: 'East Field', opponent: 'Northside' };
  const url = new URL(buildWorkspaceToolHref('stats', event), 'https://example.com');
  assert.equal(url.pathname, '/studio/stat-tracker');
  for (const [key, value] of Object.entries({ eventId: event.id, eventType: event.type, date: event.date, opponent: event.opponent })) {
    assert.equal(url.searchParams.get(key), value);
  }
});
