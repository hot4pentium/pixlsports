import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('./game-on-dashboard-collection.css', import.meta.url), 'utf8');

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
