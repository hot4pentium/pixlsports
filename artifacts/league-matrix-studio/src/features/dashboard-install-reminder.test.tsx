import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DashboardInstallReminder } from './dashboard-install-reminder';

function renderReminder(
  overrides: Partial<Parameters<typeof DashboardInstallReminder>[0]> = {},
) {
  return renderToStaticMarkup(createElement(DashboardInstallReminder, {
    action: 'instructions',
    isIOS: false,
    showInstructions: false,
    onInstall: () => undefined,
    variant: 'mobile',
    ...overrides,
  }));
}

test('dashboard reminder presents a standalone install action', () => {
  const markup = renderReminder({ action: 'install' });

  assert.match(markup, /Install app/);
  assert.match(markup, /aria-controls="dashboard-install-instructions-dialog"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.doesNotMatch(markup, /Install Pixl Sports for one-tap access/);
});

test('dashboard reminder exposes the instructions dialog state accessibly', () => {
  const markup = renderReminder({ showInstructions: true, isIOS: true });

  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /aria-controls="dashboard-install-instructions-dialog"/);
  assert.doesNotMatch(markup, /tap Share, choose Add to Home Screen, then tap Add/);
});

test('dashboard reminder is removed after install and uses distinct responsive ids', () => {
  assert.equal(renderReminder({ action: 'installed' }), '');
  assert.match(
    renderReminder({ variant: 'desktop' }),
    /data-testid="button-dashboard-install-desktop"/,
  );
});