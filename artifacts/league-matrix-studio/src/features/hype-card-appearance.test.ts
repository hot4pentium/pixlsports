import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCardAppearance, normalizeCardAppearance } from './hype-card-appearance';
import { defaultProject, normalizeHypeCardProject, designOnlyProject } from './hype-card-types';

test('legacy cards retain their existing presentation with no new appearance', () => {
  assert.deepEqual(normalizeCardAppearance(null), defaultCardAppearance());
  const breakout = defaultCardAppearance('breakout');
  assert.equal(breakout.accentLinked, true);
  assert.equal(breakout.accentColor, breakout.borderColor);
  assert.equal(normalizeHypeCardProject({ ...defaultProject(), cardAppearance: undefined }).cardAppearance.design, 'classic');
});
test('accent always follows the border and normalized placement survives save/reopen', () => {
  const appearance = { ...defaultCardAppearance('gallery'), accentLinked: false, accentColor: '#22C55E', athleteX: .15, athleteY: -.1, athleteScale: 1.2 };
  const project = { ...defaultProject(), cardAppearance: appearance, cardSport: 'soccer' };
  const normalized = normalizeCardAppearance(appearance);
  assert.equal(normalized.accentLinked, true);
  assert.equal(normalized.accentColor, normalized.borderColor);
  assert.equal(normalized.athleteX, appearance.athleteX);
  assert.deepEqual(normalizeHypeCardProject(JSON.parse(JSON.stringify(project))).cardAppearance, normalized);
  assert.deepEqual(designOnlyProject(project).cardAppearance, normalized);
});
test('unsafe colors and placements are rejected or clamped without altering photo', () => {
  const appearance = normalizeCardAppearance({ design: 'spotlight', borderColor: 'url(x)', accentColor: '#22c55e', accentLinked: false, athleteX: 12, athleteY: -12, athleteScale: Infinity });
  assert.equal(appearance.borderColor, '#EF3996');
  assert.equal(appearance.accentColor, appearance.borderColor);
  assert.equal(appearance.athleteX, .25);
  assert.equal(appearance.athleteY, -.18);
  assert.equal(appearance.athleteScale, 1);
});