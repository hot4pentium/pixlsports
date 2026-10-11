import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SupportCenter } from './support-center';
import {
  buildSupportDiagnosticReport,
  EMPTY_SUPPORT_DIAGNOSTICS,
  getSupportIssue,
  getSupportReportShareActions,
  isValidSupportReplyEmail,
  probeBrowserStorage,
  SUPPORT_ISSUES,
  type SupportDiagnostics,
} from './support-center-model';

test('support guidance is available for account, sync, schedule, Event Card, upload, and other issues', () => {
  assert.deepEqual(
    SUPPORT_ISSUES.map(({ id }) => id),
    ['account', 'sync', 'event-card', 'upload', 'other'],
  );
  assert.ok(SUPPORT_ISSUES.every(({ steps }) => steps.length > 0));
  assert.equal(getSupportIssue('event-card').label, 'Event Card');
});

test('local browser storage probe cleans up its temporary key', () => {
  const entries = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string) { entries.set(key, value); },
    removeItem(key: string) { entries.delete(key); },
  };

  assert.equal(probeBrowserStorage(storage, 'test-probe'), true);
  assert.equal(entries.size, 0);
});

test('diagnostic report contains only its allowlisted values and no account or dashboard details', () => {
  const diagnostics: SupportDiagnostics = {
    connection: 'online',
    browserStorage: 'available',
    service: 'unavailable',
  };
  const report = buildSupportDiagnosticReport({
    reference: 'PS-123e4567-e89b-12d3-a456-426614174000',
    issueId: 'sync',
    description: 'Schedule changes disappear after refresh.',
    createdAt: '2026-10-10T14:30:00.000Z',
    diagnostics,
    accountId: 'private-account-id',
    email: 'member@example.com',
    photoUrl: 'https://example.com/private-photo.jpg',
    notes: 'private schedule notes',
  } as Parameters<typeof buildSupportDiagnosticReport>[0]);

  assert.match(report, /Issue category: Schedule or sync/);
  assert.match(report, /Description:\nSchedule changes disappear after refresh\./);
  assert.match(report, /Browser connection indicator: Online/);
  assert.match(report, /Browser storage check: Available/);
  assert.match(report, /Pixl Sports service check: Not available/);
  assert.doesNotMatch(report, /private-account-id|member@example\.com|private-photo|private schedule notes/);
});

test('report sharing actions are unavailable until the member opts in', () => {
  const report = buildSupportDiagnosticReport({
    reference: 'PS-123e4567-e89b-12d3-a456-426614174000',
    issueId: 'account',
    description: 'I cannot access my schedule.',
    createdAt: '2026-10-10T14:30:00.000Z',
    diagnostics: EMPTY_SUPPORT_DIAGNOSTICS,
  });

  assert.equal(getSupportReportShareActions(report, false), null);
  const actions = getSupportReportShareActions(report, true);
  assert.ok(actions);
  assert.equal(actions.copyText, report);
});

test('support reply email validation accepts normal addresses and rejects malformed input', () => {
  assert.equal(isValidSupportReplyEmail(' parent@example.com '), true);
  assert.equal(isValidSupportReplyEmail('parent@localhost'), false);
  assert.equal(isValidSupportReplyEmail('not-an-email'), false);
});

test('blocked browser storage probe reports unavailable and attempts cleanup', () => {
  const removed: string[] = [];
  const storage = {
    setItem() { throw new Error('quota denied'); },
    removeItem(key: string) { removed.push(key); },
  };

  assert.equal(probeBrowserStorage(storage, 'blocked-test'), false);
  assert.deepEqual(removed, ['pixlsports-support-check:blocked-test']);
});

test('report sending requires a description and separately consented reply email', async () => {
  let renderer: ReactTestRenderer | undefined;
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  let requestBody: Record<string, unknown> | undefined;
  let copiedText = '';
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (value: string) => { copiedText = value; } } },
  });
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await act(async () => {
      renderer = create(createElement(SupportCenter));
    });
    assert.ok(renderer);

    const root = renderer.root;
    const find = (testId: string) => root.findByProps({ 'data-testid': testId });
    assert.equal(root.findAllByProps({ 'data-testid': 'button-send-support-report' }).length, 0);
    assert.equal(find('button-prepare-support-report').props.disabled, true);

    await act(async () => {
      find('textarea-support-description').props.onChange({
        target: { value: 'A schedule change disappears after refreshing.' },
      });
    });
    assert.equal(find('button-prepare-support-report').props.disabled, false);
    await act(async () => {
      find('button-prepare-support-report').props.onClick();
    });
    assert.equal(find('input-support-reply-email').props.value, '');
    assert.equal(
      find('preview-support-reply-email').findAllByType('span')[0].props.children,
      'Not provided',
    );
    assert.equal(root.findAllByProps({ 'data-testid': 'button-send-support-report' }).length, 0);
    assert.equal(root.findAllByProps({ 'data-testid': 'button-copy-support-report' }).length, 0);

    const preview = find('support-report-preview').props.children as string;
    await act(async () => {
      find('checkbox-share-support-report').props.onChange({ target: { checked: true } });
    });
    assert.equal(root.findAllByProps({ 'data-testid': 'button-send-support-report' }).length, 1);
    assert.equal(find('button-send-support-report').props.disabled, true);
    assert.equal(root.findAllByProps({ 'data-testid': 'button-copy-support-report' }).length, 1);

    await act(async () => {
      await find('button-copy-support-report').props.onClick();
    });
    assert.equal(copiedText, preview);
    assert.doesNotMatch(copiedText, /member@example\.com/);

    await act(async () => {
      find('input-support-reply-email').props.onChange({ target: { value: 'member@example.com' } });
    });
    assert.equal(find('button-send-support-report').props.disabled, true);
    await act(async () => {
      find('checkbox-share-support-reply-email').props.onChange({ target: { checked: true } });
    });
    assert.equal(find('button-send-support-report').props.disabled, false);
    await act(async () => {
      await find('button-send-support-report').props.onClick();
    });
    assert.equal(requestUrl, '/api/site-feedback');
    assert.equal(requestInit?.credentials, 'omit');
    assert.equal(requestBody?.feedbackType, 'problem');
    assert.equal(requestBody?.message, preview);
    assert.equal(requestBody?.replyEmail, 'member@example.com');
    assert.deepEqual(Object.keys(requestBody ?? {}).sort(), ['feedbackType', 'message', 'replyEmail']);
    assert.match(root.findAllByProps({ 'data-testid': 'support-report' })[0].findAllByType('p')
      .map((node) => String(node.props.children)).join(' '), /does not save an in-app copy/);
    const reference = preview.match(/^Reference: (PS-[0-9a-f-]{36})$/im)?.[1];
    assert.ok(reference);
    assert.equal(root.findByProps({ 'data-testid': 'status-send-support-report' }).props.role, 'status');
    assert.match(root.findByProps({ 'data-testid': 'status-send-support-report' }).props.children, new RegExp(`Report sent to support.*${reference}`));

    await act(async () => {
      find('button-cancel-support-report').props.onClick();
    });
    assert.equal(root.findAllByProps({ 'data-testid': 'support-report' }).length, 0);
    await act(async () => {
      renderer?.unmount();
      renderer = create(createElement(SupportCenter));
    });
    assert.equal(renderer.root.findAllByProps({ 'data-testid': 'support-report' }).length, 0);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = originalFetch;
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  }
});

test('reply address is previewed exactly and sent only after its separate consent', async () => {
  let renderer: ReactTestRenderer | undefined;
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const requests: Array<Record<string, unknown>> = [];
  let copiedText = '';
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (value: string) => { copiedText = value; } } },
  });
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await act(async () => {
      renderer = create(createElement(SupportCenter));
    });
    assert.ok(renderer);
    const root = renderer.root;
    const find = (testId: string) => root.findByProps({ 'data-testid': testId });
    await act(async () => {
      find('textarea-support-description').props.onChange({
        target: { value: 'The Event Card preview does not update.' },
      });
    });
    await act(async () => {
      find('button-prepare-support-report').props.onClick();
    });
    const reportText = find('support-report-preview').props.children as string;
    await act(async () => {
      find('input-support-reply-email').props.onChange({ target: { value: 'family@example.com' } });
      find('checkbox-share-support-report').props.onChange({ target: { checked: true } });
    });
    assert.match(
      find('preview-support-reply-email').findAllByType('span')[0].props.children,
      /family@example\.com/,
    );
    assert.equal(root.findAllByProps({ 'data-testid': 'checkbox-share-support-reply-email' }).length, 1);
    assert.equal(find('button-send-support-report').props.disabled, true);

    await act(async () => {
      await find('button-copy-support-report').props.onClick();
    });
    assert.equal(copiedText, reportText);
    assert.doesNotMatch(copiedText, /family@example\.com/);

    await act(async () => {
      await find('button-send-support-report').props.onClick();
    });
    assert.equal(requests.length, 0);

    await act(async () => {
      find('checkbox-share-support-reply-email').props.onChange({ target: { checked: true } });
    });
    assert.equal(find('checkbox-share-support-report').props.checked, true);
    assert.equal(find('button-send-support-report').props.disabled, false);
    await act(async () => {
      await find('button-send-support-report').props.onClick();
    });
    assert.deepEqual(requests[0], {
      feedbackType: 'problem',
      message: reportText,
      replyEmail: 'family@example.com',
    });
    assert.equal(find('input-support-reply-email').props.autoComplete, 'off');
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = originalFetch;
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  }
});
