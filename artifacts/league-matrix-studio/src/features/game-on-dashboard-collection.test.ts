import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('./game-on-dashboard-collection.css', import.meta.url), 'utf8');
const component = readFileSync(new URL('./game-on-dashboard-collection.tsx', import.meta.url), 'utf8');

test('Event Card Stat Tracker opens the game-day choice before either path', () => {
  const handlerStart = component.indexOf('const openCardPanel =');
  const handlerEnd = component.indexOf('const openCollectionCard =', handlerStart);
  const handler = component.slice(handlerStart, handlerEnd);

  assert.match(handler, /setOpenPanel\(\{ cardId: id, panel \}\)/);
  assert.doesNotMatch(handler, /setLocation|buildWorkspaceToolHref\(['"]stats/);
  assert.match(component, /Choose how to follow this game/);
  assert.match(component, /tracker-mode-heading h3/);
  assert.match(component, /<h3 tabIndex=\{-1\} data-testid=\{`heading-event-card-game-day-mode-/);
  assert.match(component, /Full Stat Tracker/);
  assert.match(component, /without recording stats/);
  assert.match(component, /<EventCardLiveTaps/);
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
