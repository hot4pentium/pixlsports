import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCalendarConnectionErrorKind,
  getCoachCalendarHandoffToken,
  getCoachCalendarSubscriptionToken,
} from './calendar-connection';

const token = 'A'.repeat(32);

test('distinguishes missing or revoked calendar connections from temporary failures', () => {
  assert.equal(getCalendarConnectionErrorKind({ status: 404 }), 'invalid');
  assert.equal(getCalendarConnectionErrorKind({ status: 503 }), 'temporary');
  assert.equal(getCalendarConnectionErrorKind(new Error('network unavailable')), 'temporary');
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
