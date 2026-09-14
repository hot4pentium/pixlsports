import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultProject,
  readHypeCardProject,
  saveHypeCardProject,
  type HypeCardProject,
} from './hype-card-types';
import { buildPositionBadgeMarkup } from './position-badge';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test('custom position labels survive local save, reload, and exported badge markup', () => {
  const labels = [
    'GK',
    'GOALKEEPER',
    'CENTER BACK DEFENSIVE MIDFIELDER EXTRAORDINARY',
  ];

  for (const position of labels) {
    const storage = new MemoryStorage();
    const project: HypeCardProject = { ...defaultProject(), position };

    saveHypeCardProject(storage as Storage, project);

    const reloaded = readHypeCardProject(storage as Storage);
    assert.ok(reloaded);
    assert.equal(reloaded.position, position);
    assert.match(
      buildPositionBadgeMarkup(reloaded.position, '#123456', '#abcdef'),
      new RegExp(`>${position.toUpperCase()}<`),
    );
  }
});