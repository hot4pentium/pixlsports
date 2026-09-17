import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStoredCalendarConnection,
  getCalendarConnectionErrorKind,
  getCoachCalendarHandoffToken,
  getCoachCalendarSubscriptionToken,
} from './calendar-connection';

const token = 'A'.repeat(32);

function createStorage(values: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  };
}

test('distinguishes missing or revoked calendar connections from temporary failures', () => {
  assert.equal(getCalendarConnectionErrorKind({ status: 404 }), 'invalid');
  assert.equal(getCalendarConnectionErrorKind({ status: 503 }), 'temporary');
  assert.equal(getCalendarConnectionErrorKind(new Error('network unavailable')), 'temporary');
});

test('reads the active subscription connection before a legacy coach code', () => {
  const storage = createStorage({
    'leaguematrix-connected-coach-code': 'ABCDE',
    'leaguematrix-connected-coach-subscription-token': token,
  });
  assert.deepEqual(getStoredCalendarConnection(storage), {
    kind: 'subscription',
    value: token,
  });
});

test('falls back to the stored coach code when no valid subscription exists', () => {
  const storage = createStorage({
    'leaguematrix-connected-coach-code': 'ABCDE',
    'leaguematrix-connected-coach-subscription-token': 'too-short',
  });
  assert.deepEqual(getStoredCalendarConnection(storage), {
    kind: 'code',
    value: 'ABCDE',
  });
});

test('accepts Pixl Sports subscription links and extracts the token', () => {
  assert.equal(
    getCoachCalendarSubscriptionToken(
      `https://pixlsports.com/api/coach-calendar/feed/${token}.ics`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    token,
  );
  assert.equal(
    getCoachCalendarSubscriptionToken(
      `webcal://www.pixlsports.com/api/coach-calendar/feed/${token}`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    token,
  );
  assert.equal(
    getCoachCalendarSubscriptionToken(
      `/api/coach-calendar/feed/${token}.ics`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    token,
  );
});

test('rejects unrelated, malformed, and unsupported calendar links', () => {
  assert.equal(
    getCoachCalendarSubscriptionToken(
      `https://calendar.example.com/api/coach-calendar/feed/${token}.ics`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    null,
  );
  assert.equal(
    getCoachCalendarSubscriptionToken(
      'https://pixlsports.com/api/coach-calendar/feed/too-short.ics',
      'https://studio.example.test',
      'studio.example.test',
    ),
    null,
  );
  assert.equal(
    getCoachCalendarSubscriptionToken(
      `ftp://pixlsports.com/api/coach-calendar/feed/${token}.ics`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    null,
  );
});

test('accepts Pixl Sports app handoff links without accepting arbitrary query tokens', () => {
  assert.equal(
    getCoachCalendarHandoffToken(
      `https://pixlsports.com/studio/schedule?calendarToken=${token}`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    token,
  );
  assert.equal(
    getCoachCalendarSubscriptionToken(
      `https://www.pixlsports.com/studio/schedule?calendar=${token}`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    null,
  );
  assert.equal(
    getCoachCalendarHandoffToken(
      `https://calendar.example.com/studio/schedule?calendarToken=${token}`,
      'https://studio.example.test',
      'studio.example.test',
    ),
    null,
  );
});
