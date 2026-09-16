import assert from 'node:assert/strict';
import test from 'node:test';
import { getCoachCalendarSubscriptionToken } from './calendar-connection';

const token = 'A'.repeat(32);

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