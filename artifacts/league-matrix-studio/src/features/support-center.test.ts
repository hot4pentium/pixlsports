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
    createdAt: '2026-10-10T14:30:00.000Z',
    diagnostics,
    accountId: 'private-account-id',
    email: 'member@example.com',
    photoUrl: 'https://example.com/private-photo.jpg',
    notes: 'private schedule notes',
  } as Parameters<typeof buildSupportDiagnosticReport>[0]);

  assert.match(report, /Issue category: Schedule or sync/);
  assert.match(report, /Browser connection indicator: Online/);
  assert.match(report, /Browser storage check: Available/);
  assert.match(report, /Pixl Sports service check: Not available/);
  assert.doesNotMatch(report, /private-account-id|member@example\.com|private-photo|private schedule notes/);
});

test('report sharing actions are unavailable until the member opts in', () => {
  const report = buildSupportDiagnosticReport({
    reference: 'PS-123e4567-e89b-12d3-a456-426614174000',
    issueId: 'account',
    createdAt: '2026-10-10T14:30:00.000Z',
    diagnostics: EMPTY_SUPPORT_DIAGNOSTICS,
  });

  assert.equal(getSupportReportShareActions(report, false), null);
  const actions = getSupportReportShareActions(report, true);
  assert.ok(actions);
  assert.equal(actions.copyText, report);
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

test('report sending stays hidden until consent, sends the reviewed body, and closing clears the preview', async () => {
  let renderer: ReactTestRenderer | undefined;
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  let requestBody: Record<string, unknown> | undefined;
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

    await act(async () => {
      find('button-prepare-support-report').props.onClick();
    });
    assert.equal(root.findAllByProps({ 'data-testid': 'button-send-support-report' }).length, 0);
    assert.equal(root.findAllByProps({ 'data-testid': 'button-copy-support-report' }).length, 0);

    const preview = find('support-report-preview').props.children as string;
    await act(async () => {
      find('checkbox-share-support-report').props.onChange({ target: { checked: true } });
    });
    assert.equal(root.findAllByProps({ 'data-testid': 'button-send-support-report' }).length, 1);
    assert.equal(root.findAllByProps({ 'data-testid': 'button-copy-support-report' }).length, 1);

    await act(async () => {
      await find('button-send-support-report').props.onClick();
    });
    assert.equal(requestUrl, '/api/site-feedback');
    assert.equal(requestInit?.credentials, 'omit');
    assert.equal(requestBody?.feedbackType, 'problem');
    assert.equal(requestBody?.message, preview);
    assert.deepEqual(Object.keys(requestBody ?? {}).sort(), ['feedbackType', 'message']);
    const reference = preview.match(/^Reference: (PS-[0-9a-f-]{36})$/im)?.[1];
    assert.ok(reference);
    assert.equal(root.findByProps({ 'data-testid': 'status-send-support-report' }).props.role, 'status');
    assert.match(root.findByProps({ 'data-testid': 'status-send-support-report' }).props.children, new RegExp(`Report sent to support.*${reference}`));

    await act(async () => {
      find('button-cancel-support-report').props.onClick();
    });
    assert.equal(root.findAllByProps({ 'data-testid': 'support-report' }).length, 0);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});
