import assert from 'node:assert/strict';
import test from 'node:test';
import { act, create, type ReactTestRenderer, type ReactTestRendererNode } from 'react-test-renderer';
import { createElement } from 'react';

import { StudioRoleBoundary } from './studio-role-boundary';

// React 19 requires this flag for act() to flush test-renderer updates.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestUser = {
  unsafeMetadata: { role?: string };
};

function userWithRole(role?: string): TestUser {
  return { unsafeMetadata: role ? { role } : {} };
}

function StudioSession({
  user,
  isLoaded = true,
  isSignedIn = true,
}: {
  user: TestUser;
  isLoaded?: boolean;
  isSignedIn?: boolean;
}) {
  return createElement(StudioRoleBoundary, {
    user,
    isLoaded,
    isSignedIn,
    loading: createElement('p', null, 'Loading your studio…'),
    signedOut: createElement('p', null, 'Sign in to continue'),
    roleSelection: createElement('section', null,
      createElement('h1', null, 'Pick your playbook'),
      createElement('nav', null, 'Coach or Fan'),
    ),
    supporter: createElement('section', null,
      createElement('nav', null, 'Game Day Hub · Hype Card · Schedule · My Athlete'),
      createElement('h1', null, 'Fan Command Center'),
      createElement('p', null, 'Fan controls'),
    ),
    coach: createElement('section', null,
      createElement('nav', null, 'Command Center · Schedule · Roster'),
      createElement('h1', null, 'Coach Command Center'),
      createElement('p', null, 'Coach controls'),
    ),
  });
}

function renderedText(renderer: ReactTestRenderer): string {
  type RenderedNode = ReactTestRendererNode | ReactTestRendererNode[] | null;
  const visit = (node: RenderedNode): string => {
    if (node === null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(visit).join('');
    return (node.children ?? []).map(visit).join('');
  };
  return visit(renderer.toJSON());
}

test('a mounted session replaces fan UI with coach UI when Clerk metadata changes', () => {
  const user = userWithRole('fan');
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(createElement(StudioSession, { user }));
  });
  assert.match(renderedText(renderer), /Fan Command Center/);
  assert.match(renderedText(renderer), /Game Day Hub/);
  assert.doesNotMatch(renderedText(renderer), /Coach controls/);

  user.unsafeMetadata.role = 'coach';
  act(() => {
    renderer.update(createElement(StudioSession, { user }));
  });
  assert.match(renderedText(renderer), /Coach Command Center/);
  assert.match(renderedText(renderer), /Command Center · Schedule · Roster/);
  assert.match(renderedText(renderer), /Coach controls/);
  assert.doesNotMatch(renderedText(renderer), /Fan controls/);
  assert.doesNotMatch(renderedText(renderer), /My Athlete/);
});

test('a mounted session replaces coach UI with fan UI when Clerk metadata changes', () => {
  const user = userWithRole('coach');
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(createElement(StudioSession, { user }));
  });
  assert.match(renderedText(renderer), /Coach Command Center/);
  assert.doesNotMatch(renderedText(renderer), /Fan controls/);

  user.unsafeMetadata.role = 'fan';
  act(() => {
    renderer.update(createElement(StudioSession, { user }));
  });
  assert.match(renderedText(renderer), /Fan Command Center/);
  assert.match(renderedText(renderer), /Game Day Hub · Hype Card · Schedule · My Athlete/);
  assert.match(renderedText(renderer), /Fan controls/);
  assert.doesNotMatch(renderedText(renderer), /Coach controls/);
  assert.doesNotMatch(renderedText(renderer), /Roster/);
});

test('loading and missing-role states never expose either role dashboard', () => {
  const user = userWithRole();
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(createElement(StudioSession, { user, isLoaded: false }));
  });
  assert.match(renderedText(renderer), /Loading your studio/);
  assert.doesNotMatch(renderedText(renderer), /Command Center/);
  assert.doesNotMatch(renderedText(renderer), /Fan controls/);

  act(() => {
    renderer.update(createElement(StudioSession, { user, isLoaded: true }));
  });
  assert.match(renderedText(renderer), /Pick your playbook/);
  assert.doesNotMatch(renderedText(renderer), /Fan Command Center/);
  assert.doesNotMatch(renderedText(renderer), /Coach Command Center/);
});