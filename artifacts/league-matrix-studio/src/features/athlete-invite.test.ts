import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./athlete-invite.tsx', import.meta.url), 'utf8');

test('public Athlete Hype Pages keep replies on-page and update recent reactions after sending', () => {
  assert.match(source, /HypeCardReplyComposer/);
  assert.match(source, /Choose a reaction and add an optional message without leaving this athlete page/);
  assert.match(source, /shareToken=\{invite\.hypeCard\.shareToken\}/);
  assert.match(source, /setLocalReplies/);
  assert.doesNotMatch(source, /Send your own reply →/);
});

test('Hype Card entry expands creation steps and manages the hosted card', () => {
  assert.match(source, /aria-expanded=\{hypeCardGuideOpen\}/);
  assert.match(source, /How it works/);
  assert.match(source, /Open the Hype Card editor and create the card/);
  assert.match(source, /Choose Post to Athlete Hype Page/);
  assert.match(source, /downloadHypeCardShare/);
  assert.match(source, /useDeleteHypeCardShare/);
  assert.match(source, /The Athlete Hype Page and its other content were not changed/);
});