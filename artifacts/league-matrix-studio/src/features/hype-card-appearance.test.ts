import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCardAppearance, normalizeCardAppearance, resolveHypeCardAthleteName, seedCardAppearanceFromProfile } from './hype-card-appearance';
import { defaultProject, normalizeHypeCardProject, designOnlyProject } from './hype-card-types';

test('background choices survive normalization and saved projects while legacy cards match sport', () => {
  assert.equal(normalizeCardAppearance({ design: 'breakout' }).background, 'sport');
  assert.equal(normalizeCardAppearance({ background: 'https://untrusted.example/image.png' }).background, 'sport');
  for (const background of ['sport', 'stadium', 'tunnel', 'studio'] as const) {
    const appearance = { ...defaultCardAppearance('breakout'), background };
    assert.equal(normalizeCardAppearance(appearance).background, background);
    assert.equal(normalizeHypeCardProject({ ...defaultProject(), cardAppearance: appearance }).cardAppearance.background, background);
    assert.equal(designOnlyProject({ ...defaultProject(), cardAppearance: appearance }).cardAppearance.background, background);
  }
});

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
test('card appearance fills blank player details from the profile without replacing saved values', () => {
  const seeded = seedCardAppearanceFromProfile(defaultCardAppearance('gallery'), {
    jerseyNumber: '#23',
    position: ' Forward ',
  });
  assert.equal(seeded.jerseyNumber, '23');
  assert.equal(seeded.position, 'Forward');

  const saved = seedCardAppearanceFromProfile({
    ...defaultCardAppearance('gallery'),
    jerseyNumber: '12',
    position: 'Guard',
  }, { jerseyNumber: '23', position: 'Forward' });
  assert.equal(saved.jerseyNumber, '12');
  assert.equal(saved.position, 'Guard');
});
test('HYPE Card artwork uses the current profile name before the saved invite name', () => {
  assert.equal(resolveHypeCardAthleteName(' Current Profile Name ', 'Older Invite Name'), 'Current Profile Name');
  assert.equal(resolveHypeCardAthleteName('', 'Saved Invite Name'), 'Saved Invite Name');
  assert.equal(resolveHypeCardAthleteName('', ''), 'Athlete');
});
test('unsafe colors and placements are rejected or clamped without altering photo', () => {
  const appearance = normalizeCardAppearance({ design: 'spotlight', borderColor: 'url(x)', accentColor: '#22c55e', accentLinked: false, athleteX: 12, athleteY: -12, athleteScale: Infinity });
  assert.equal(appearance.borderColor, '#EF3996');
  assert.equal(appearance.accentColor, appearance.borderColor);
  assert.equal(appearance.athleteX, .25);
  assert.equal(appearance.athleteY, -.18);
  assert.equal(appearance.athleteScale, 1);
  assert.equal(normalizeCardAppearance({ ...defaultCardAppearance('spotlight'), athleteScale: 1.45 }).athleteScale, 1.2,
    'legacy designs above the supported limit are clamped to 120%');
});