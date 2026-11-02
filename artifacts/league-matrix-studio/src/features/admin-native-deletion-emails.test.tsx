import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminNativeDeletionEmail } from '@workspace/api-client-react';
import { AdminNativeDeletionEmailRows } from './admin-native-deletion-emails';

test('read-only email rows describe acceptance and ambiguity without profiles or unsafe controls', () => {
  const stages: AdminNativeDeletionEmail['stage'][] = [
    'awaiting_cleanup', 'waiting_to_send', 'provider_accepted', 'delivery_uncertain',
    'review_required', 'contact_retention_expired', 'no_verified_contact',
  ];
  const items = stages.map((stage, index): AdminNativeDeletionEmail => ({
    reference: `00000000-0000-4000-8000-00000000000${index}`, stage,
    scope: index % 2 ? 'iphone_access' : 'independent',
    requestedAt: '2026-11-01T12:00:00Z', completedAt: null,
    firstAttemptAt: null, lastAttemptAt: null,
    providerAcceptedAt: stage === 'provider_accepted' ? '2026-11-02T12:00:00Z' : null,
  }));
  const markup = renderToStaticMarkup(createElement(AdminNativeDeletionEmailRows, { items }));
  for (const label of [
    'Awaiting cleanup', 'Waiting to send', 'Accepted by email provider', 'Delivery uncertain',
    'Uncertain — review required', 'Contact retention expired', 'No verified contact available',
    'Inbox delivery and whether it was read are not known', 'do not blindly resend',
    'web data preserved', 'Last worker attempt',
  ]) assert.ok(markup.includes(label), `Missing: ${label}`);
  assert.doesNotMatch(markup, /<button|<a |<input|<form|Reactivate|Restore|user read the email/);
  assert.equal((markup.match(/<tbody>/g) ?? []).length, 1);
  items.forEach(item => assert.ok(markup.includes(item.reference)));
});
