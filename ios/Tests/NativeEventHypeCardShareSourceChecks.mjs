import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shareView = readFileSync(new URL('../PIXL Sports/NativeEventShareView.swift', import.meta.url), 'utf8');
const api = readFileSync(new URL('../PIXL Sports/SupporterHomeAPI.swift', import.meta.url), 'utf8');

test('the iPhone Share screen offers a direct HYPE Card share action', () => {
  assert.match(shareView, /ShareLink\(item: shareURL\)[\s\S]*?Label\("Share HYPE Card"/);
  assert.match(shareView, /native-event-share-hype-direct/);
  assert.match(shareView, /hypeCardShareCard[\s\S]*?hypeCardShareAction/);
});

test('direct sharing is offered only for a currently public, unpaused HYPE Card', () => {
  const shareLookup = api.slice(
    api.indexOf('static func fetchOwnerHypeCardShareURL'),
    api.indexOf('static func fetchPublicHypeCard(inviteToken: String)'),
  );
  assert.match(shareLookup, /reference\.status == "available"/);
  assert.match(shareLookup, /settings\.showHypeCard/);
  assert.match(shareLookup, /!settings\.paused/);
  assert.match(shareLookup, /inviteToken\.range\(of: "\^\[A-Za-z0-9_-\]\{1,128\}\$"/);
  assert.match(shareLookup, /appendingPathComponent\("fan"\)/);
  assert.match(shareView, /This HYPE Card is private or paused/);
});

test('share availability failures can be retried without publishing a private card', () => {
  assert.match(shareView, /native-event-hype-share-retry/);
  assert.match(shareView, /native-event-hype-share-unavailable/);
  assert.match(shareView, /refreshHypeCardShareURL\(\)/);
});
