import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidSupportReplyEmail,
  probeBrowserStorage,
  readStoredTicketAccess,
  SUPPORT_ISSUES,
  SUPPORT_TICKETS_STORAGE_KEY,
  writeStoredTicketAccess,
} from './support-center-model';

test('support issue choices cover every API category', () => {
  assert.deepEqual(
    SUPPORT_ISSUES.map((issue) => issue.id),
    ['account', 'billing', 'schedule', 'game-day', 'hype-card', 'other'],
  );
});

test('reply email validation accepts normal addresses and rejects invalid input', () => {
  assert.equal(isValidSupportReplyEmail('member@example.com'), true);
  assert.equal(isValidSupportReplyEmail(' member+help@example.com '), true);
  assert.equal(isValidSupportReplyEmail('member@example'), false);
  assert.equal(isValidSupportReplyEmail('not an email'), false);
});

test('anonymous ticket storage keeps only ticket ids and access tokens', () => {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });

  writeStoredTicketAccess([{ id: 'ticket-1', token: 'private-token' }]);
  assert.deepEqual(readStoredTicketAccess(), [{ id: 'ticket-1', token: 'private-token' }]);
  assert.equal(values.get(SUPPORT_TICKETS_STORAGE_KEY), '[{"id":"ticket-1","token":"private-token"}]');

  values.set(SUPPORT_TICKETS_STORAGE_KEY, JSON.stringify([
    { id: 'ticket-2', token: 'token-2', email: 'must-not-survive@example.com', description: 'private' },
    { id: 42, token: 'bad' },
  ]));
  assert.deepEqual(readStoredTicketAccess(), [{ id: 'ticket-2', token: 'token-2' }]);
});

test('browser storage probe always removes its temporary key', () => {
  const values = new Map<string, string>();
  assert.equal(probeBrowserStorage({
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  }, 'test'), true);
  assert.equal(values.size, 0);
});
