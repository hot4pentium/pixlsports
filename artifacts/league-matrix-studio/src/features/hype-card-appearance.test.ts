import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCardAppearance, normalizeCardAppearance, resolveHypeCardAthleteName, seedCardAppearanceFromProfile, switchCardAppearanceDesign } from './hype-card-appearance';
import { defaultProject, getDimensions, normalizeHypeCardProject, designOnlyProject } from './hype-card-types';

test('four simplified lower-third choices persist with photo position while legacy cards use classic', () => {
  assert.equal(normalizeCardAppearance(null).lowerThirdStyle, 'classic');
  assert.equal(normalizeCardAppearance({ lowerThirdStyle: 'unknown' }).lowerThirdStyle, 'classic');
  for (const lowerThirdStyle of ['classic', 'split', 'angled', 'none'] as const) {
    const appearance = normalizeCardAppearance({ lowerThirdStyle, athleteX: .12, athleteY: -.08, jerseyNumber: '23', position: 'Forward' });
    const restored = normalizeHypeCardProject(JSON.parse(JSON.stringify({ ...defaultProject(), cardAppearance: appearance })));
    assert.equal(restored.cardAppearance.lowerThirdStyle, lowerThirdStyle);
    assert.equal(restored.cardAppearance.athleteX, .12);
    assert.equal(restored.cardAppearance.athleteY, -.08);
    assert.equal(restored.cardAppearance.jerseyNumber, '23');
    assert.equal(restored.cardAppearance.position, 'Forward');
    assert.equal(designOnlyProject(restored).cardAppearance.lowerThirdStyle, lowerThirdStyle);
  }
});

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

test('frame and lower-third choices are independent while photo placement stays editable', () => {
  let appearance = normalizeCardAppearance({
    ...defaultCardAppearance('velocity'),
    athleteX: .18,
    athleteY: -.1,
    athleteScale: 1.15,
    lowerThirdTemplate: 'wave',
  });
  for (const design of ['glass', 'varsity', 'spotlight', 'pixel-edge', 'wave', 'velocity'] as const) {
    appearance = switchCardAppearanceDesign(appearance, design);
    assert.equal(appearance.design, design);
    assert.equal(appearance.lowerThirdTemplate, 'wave', 'changing the frame does not reset the selected lower third');
    assert.deepEqual([appearance.athleteX, appearance.athleteY, appearance.athleteScale], [.18, -.1, 1.15]);
    appearance = normalizeCardAppearance(JSON.parse(JSON.stringify(appearance)));
  }
  appearance = normalizeCardAppearance({ ...appearance, lowerThirdTemplate: 'glass' });
  assert.equal(appearance.design, 'velocity');
  assert.equal(appearance.lowerThirdTemplate, 'glass');
});

test('legacy cards map to the closest replacement template and keep their photo placement', () => {
  const appearance = normalizeCardAppearance({ design: 'gallery', athleteX: .16, athleteY: -.12, athleteScale: 1.1 });
  assert.equal(appearance.design, 'glass');
  for (const design of ['velocity', 'wave', 'glass', 'varsity', 'spotlight', 'pixel-edge'] as const) {
    const selected = switchCardAppearanceDesign(appearance, design);
    assert.deepEqual([selected.athleteX, selected.athleteY, selected.athleteScale], [.16, -.12, 1.1]);
  }
});

test('missing and legacy appearance values normalize to the replacement templates', () => {
  assert.deepEqual(normalizeCardAppearance(null), defaultCardAppearance());
  assert.equal(normalizeCardAppearance({ design: 'classic' }).design, 'velocity');
  assert.equal(normalizeCardAppearance({ design: 'gallery' }).design, 'glass');
  assert.equal(normalizeCardAppearance({ design: 'spotlight' }).design, 'spotlight');
  assert.equal(normalizeCardAppearance({ design: 'breakout' }).design, 'pixel-edge');
  assert.equal(normalizeHypeCardProject({ ...defaultProject(), cardAppearance: undefined }).cardAppearance.design, 'velocity');
  assert.deepEqual(getDimensions('card'), { width: 900, height: 1200 });
});
test('custom border and accent colors and normalized placement survive save/reopen', () => {
  const appearance = { ...defaultCardAppearance('gallery'), accentLinked: false, accentColor: '#22C55E', athleteX: .15, athleteY: -.1, athleteScale: 1.2 };
  const project = { ...defaultProject(), cardAppearance: appearance, cardSport: 'soccer' };
  const normalized = normalizeCardAppearance(appearance);
  assert.equal(normalized.design, 'glass');
  assert.equal(normalized.accentLinked, false);
  assert.equal(normalized.accentColor, '#22C55E');
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
  assert.equal(appearance.borderColor, '#D8B35A');
  assert.equal(appearance.accentColor, '#22C55E');
  assert.equal(appearance.athleteX, .25);
  assert.equal(appearance.athleteY, -.18);
  assert.equal(appearance.athleteScale, 1);
  assert.equal(normalizeCardAppearance({ ...defaultCardAppearance('spotlight'), athleteScale: 1.45 }).athleteScale, 1.45,
    'template zoom supports the full requested 160% range');
});