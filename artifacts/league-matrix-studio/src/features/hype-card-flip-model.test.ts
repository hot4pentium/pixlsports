import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armFlip, availableCardSides, beginFlip, initialFlipState, parseRequestedSide,
  primaryTabs, reconcileFlip, settleFlip, visibleFace, type CardSide, type FlipState,
} from './hype-card-flip-model';

test('shared card faces remain readable and visible without motion', () => {
  const css = readFileSync(new URL('./living-athlete-card.css', import.meta.url), 'utf8');
  const reducedMotion = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reducedMotion, /\.lc-native-flip-inner \.living-card-flip-face \{ display: none; transform: none;/);
  assert.match(reducedMotion, /\[data-rotated="false"\] \.living-card-flip-front,\s*\.lc-native-flip-inner\[data-rotated="true"\] \.living-card-flip-back \{ display: block; \}/);
  assert.match(css, /\.lc-native-flip-inner \.living-card-face-alt \{[^}]*color: #f7f9fc;/);
});

const all = availableCardSides({ hasStats: true, showEvents: true });

function run(state: FlipState, next: CardSide, available = all) {
  const seen: CardSide[] = [];
  let s = beginFlip(state, next, available);
  seen.push(visibleFace(s));
  s = armFlip(s);
  seen.push(visibleFace(s));
  s = settleFlip(s);
  seen.push(visibleFace(s));
  return { s, seen };
}

test('native side order: Front, Videos, Stats, Events with privacy gating', () => {
  assert.deepEqual(primaryTabs(all), ['front', 'videos', 'stats', 'events']);
  assert.deepEqual(primaryTabs(availableCardSides({ hasStats: false, showEvents: false })), ['front', 'videos']);
  assert.deepEqual(primaryTabs(availableCardSides({ hasStats: false, hasLiveScoreboard: true, showEvents: false })), ['front', 'videos', 'stats']);
  assert.ok(all.includes('responses') && all.includes('live-taps'), 'Shoutouts and Live Taps stay reachable');
});

test('switching between sections never shows Front', () => {
  let { s } = run(initialFlipState(), 'videos');
  assert.equal(visibleFace(s), 'videos');
  const step = beginFlip(s, 'stats', all);
  assert.equal(step.frontFace, 'videos');
  assert.equal(step.animate, false);
  const result = run(s, 'stats');
  assert.ok(!result.seen.includes('front'), `saw ${result.seen.join(',')}`);
  assert.equal(visibleFace(result.s), 'stats');
  s = result.s;
  const toEvents = run(s, 'events');
  assert.ok(!toEvents.seen.includes('front'));
});

test('only Front returns to the photo, and busy flips ignore input', () => {
  const { s } = run(initialFlipState(), 'events');
  const back = beginFlip(s, 'front', all);
  assert.equal(back.rotated, false);
  assert.equal(beginFlip(back, 'stats', all), back);
  assert.equal(visibleFace(settleFlip(back)), 'front');
});

test('reduced motion and unavailable sides', () => {
  const s = beginFlip(initialFlipState('stats'), 'events', all, true);
  assert.equal(s.busy, false);
  assert.equal(visibleFace(s), 'events');
  const noEvents = availableCardSides({ hasStats: true, showEvents: false });
  assert.equal(beginFlip(initialFlipState(), 'events', noEvents).selected, 'front');
  assert.deepEqual(reconcileFlip(s, noEvents), initialFlipState());
  assert.equal(parseRequestedSide('videos'), 'videos');
  assert.equal(parseRequestedSide('bogus'), 'front');
});
