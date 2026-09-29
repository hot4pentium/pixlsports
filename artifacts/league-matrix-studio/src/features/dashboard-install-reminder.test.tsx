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

test('dashboard reminder offers quick access and keeps phone alerts separate', () => {
  const markup = renderReminder({ action: 'install' });

  assert.match(markup, /Install Pixl Sports for one-tap access/);
  assert.match(markup, /Profile → Phone Alerts/);
  assert.match(markup, /Adding a shortcut does not enable alerts/);
  assert.match(markup, /Install app/);
  assert.match(markup, /aria-expanded="false"/);
});

test('dashboard reminder shows platform instructions with an accessible status', () => {
  const markup = renderReminder({ showInstructions: true, isIOS: true });

  assert.match(markup, /role="status"/);
  assert.match(markup, /tap Share, choose Add to Home Screen, then tap Add/);
  assert.match(markup, /aria-controls="dashboard-install-instructions-mobile"/);
});

test('dashboard reminder is removed after install and uses distinct responsive ids', () => {
  assert.equal(renderReminder({ action: 'installed' }), '');
  assert.match(
    renderReminder({ variant: 'desktop', showInstructions: true }),
    /id="dashboard-install-instructions-desktop"/,
  );
});