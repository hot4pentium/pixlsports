import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCardAppearance, normalizeCardAppearance } from './hype-card-appearance';
import { defaultProject, normalizeHypeCardProject, designOnlyProject } from './hype-card-types';

test('legacy cards retain their existing presentation with no new appearance', () => {
  assert.deepEqual(normalizeCardAppearance(null), defaultCardAppearance());
  assert.equal(normalizeHypeCardProject({ ...defaultProject(), cardAppearance: undefined }).cardAppearance.design, 'classic');
});
test('independent colors and normalized placement survive save/reopen and portable design', () => {
  const appearance = { ...defaultCardAppearance('gallery'), accentLinked: false, accentColor: '#22C55E', athleteX: .15, athleteY: -.1, athleteScale: 1.2 };
  const project = { ...defaultProject(), cardAppearance: appearance, cardSport: 'soccer' };
  assert.deepEqual(normalizeHypeCardProject(JSON.parse(JSON.stringify(project))).cardAppearance, appearance);
  assert.deepEqual(designOnlyProject(project).cardAppearance, appearance);
});
test('unsafe colors and placements are rejected or clamped without altering photo', () => {
  const appearance = normalizeCardAppearance({ design: 'spotlight', borderColor: 'url(x)', accentColor: '#22c55e', accentLinked: false, athleteX: 12, athleteY: -12, athleteScale: Infinity });
  assert.equal(appearance.borderColor, '#EF3996');
  assert.equal(appearance.accentColor, '#22C55E');
  assert.equal(appearance.athleteX, .25);
  assert.equal(appearance.athleteY, -.18);
  assert.equal(appearance.athleteScale, 1);
});