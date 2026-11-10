import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('./game-on-dashboard-collection.css', import.meta.url), 'utf8');
const component = readFileSync(new URL('./game-on-dashboard-collection.tsx', import.meta.url), 'utf8');

test('the Event Card Share page separates event details from public HYPE Card sharing', () => {
  assert.match(component, /const publicHypeCardUrl = hypeCardShareToken \? athleteFanCardUrl\(hypeCardShareToken\) : null/);
  assert.match(component, /button-close-game-on-share-/);
  assert.match(component, /Share event details/);
  assert.match(component, /Share HYPE Card/);
  assert.match(component, /<HypeCardShareQr url=\{publicHypeCardUrl\}/);
  assert.match(component, /publicHypeCardUrl \? \([\s\S]*?<HypeCardShareQr/);
  assert.match(component, /HYPE Card sharing is unavailable while the public card is hidden or paused/);
  assert.match(component, /href=\{hypeCardManageHref \?\? '\/studio\/athlete-page'\}/);
  const dashboard = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /!savedFanCard.paused && savedFanCard.showHypeCard && Date.parse\(savedFanCard.seasonEndsAt\) > currentTime.getTime\(\)/);
});

test('the selected Event Card Share action opens an accessible Share page', () => {
  assert.match(component, /panel: 'calendar' \| 'prep' \| 'tracker' \| 'share'/);
  assert.match(component, /onOpenPanel\(card\.id, 'share', event\.currentTarget\)/);
  assert.match(component, /aria-expanded=\{shareOpen\}/);
  assert.match(component, /data-testid=\{`panel-game-on-share-\$\{card\.id\}`\}/);
  assert.match(component, /role="status" aria-live="polite" data-testid=\{`status-share-hype-card-\$\{card\.id\}`\}/);
});

test('Event Card Stat Tracker opens the game-day choice before either path', () => {
  const handlerStart = component.indexOf('const openCardPanel =');
  const handlerEnd = component.indexOf('const openCollectionCard =', handlerStart);
  const handler = component.slice(handlerStart, handlerEnd);

  assert.match(handler, /setOpenPanel\(\{ cardId: id, panel \}\)/);
  assert.doesNotMatch(handler, /setLocation|buildWorkspaceToolHref\(['"]stats/);
  assert.match(component, /Choose how to follow this game/);
  assert.match(component, /tracker-mode-heading h3/);
  assert.match(component, /<h3 tabIndex=\{-1\} data-testid=\{`heading-event-card-game-day-mode-/);
  assert.match(component, /Full tracker/);
  assert.match(component, /data-testid=\{`link-open-stat-tracker-\$\{card\.id\}`\}/);
  assert.match(component, /without recording stats/);
  assert.match(component, /<EventCardLiveTaps[\s\S]*?eventId=\{eventId\}/);
  assert.doesNotMatch(handler, /createGameSession|localStorage|startLiveTaps/);
});

test('saving a local Event Card refreshes the draft list before selecting its saved identity', () => {
  const dashboard = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
  const start = dashboard.indexOf('const handleGameOnCardChanged =');
  const end = dashboard.indexOf('const saveDashboardChecklistProgress =', start);
  const handler = dashboard.slice(start, end);
  assert.match(handler, /setLocalGameOnCardDrafts\(readOfflineGameOnCardDrafts\(userId\)\)/);
  assert.ok(
    handler.indexOf('setLocalGameOnCardDrafts') < handler.indexOf('setNewCardDraft(null)'),
    'the dashboard must refresh persisted local drafts when replacing the temporary editor',
  );
});

test('unselected Stat Tracker and Share actions stay neutral while an open tracker remains distinct', () => {
  for (const action of ['tracker', 'share']) {
    const rule = styles.match(new RegExp(`\\.game-on-collection__actions \\.game-on-collection__action--${action} \\{([^}]*)\\}`))?.[1];
    assert.ok(rule, `${action} action should have a base style`);
    assert.match(rule, /border-color: #c1d5e8/);
    assert.match(rule, /background: #fff/);
    assert.match(rule, /color: #17467b/);
    assert.match(rule, /box-shadow: none/);
  }

  assert.match(
    styles,
    /\.game-on-collection__actions \.game-on-collection__action--tracker\[aria-expanded="true"\] \{[^}]*background: #12355c/,
    'opening Stat Tracker should still have a clear active state',
  );
});
