import assert from 'node:assert/strict';
import test from 'node:test';
import { act, create } from 'react-test-renderer';
import React, { createElement } from 'react';

import { AdminAuditMemberFilter } from './admin-audit-member-filter';

// React 19 requires this flag for act() to flush test-renderer updates.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member = {
  clerkUserId: 'user_stable_123',
  firstName: 'Alex',
  lastName: 'Morgan',
  primaryEmailAddress: 'alex@example.com',
  profile: { displayName: null },
};

test('audit member search selects a person while returning the stable Clerk ID', () => {
  let selectedId = '';
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(AdminAuditMemberFilter, {
      searchText: 'Alex',
      selectedMember: null,
      members: [member],
      isSearching: false,
      searchError: false,
      onSearchTextChange: () => undefined,
      onSelectMember: (selected) => { selectedId = selected.clerkUserId; },
      onClearSelection: () => undefined,
    }));
  });

  assert.equal(renderer.root.findByProps({ role: 'combobox' }).props['aria-expanded'], true);
  const optionText = renderer.root.findByProps({ id: 'admin-audit-member-options-0' })
    .findAllByType('span')
    .map((span) => span.children.join(''))
    .join(' ');
  assert.match(optionText, /Alex Morgan/);
  assert.match(optionText, /alex@example.com/);

  act(() => {
    renderer.root.findByProps({ id: 'admin-audit-member-options-0' }).props.onClick();
  });
  assert.equal(selectedId, 'user_stable_123');
});

test('clearing the selected audit member is available as a distinct action', () => {
  let cleared = false;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(AdminAuditMemberFilter, {
      searchText: '',
      selectedMember: member,
      members: [],
      isSearching: false,
      searchError: false,
      onSearchTextChange: () => undefined,
      onSelectMember: () => undefined,
      onClearSelection: () => { cleared = true; },
    }));
  });

  assert.equal(renderer.root.findAllByProps({ role: 'combobox' }).length, 0);
  act(() => {
    renderer.root.findByProps({ 'aria-label': 'Clear selected member Alex Morgan' }).props.onClick();
  });
  assert.equal(cleared, true);
});

test('the audit member suggestions can be selected with the keyboard', () => {
  let selectedId = '';
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(AdminAuditMemberFilter, {
      searchText: 'Alex',
      selectedMember: null,
      members: [
        member,
        { ...member, clerkUserId: 'user_stable_456', firstName: 'Jordan', lastName: 'Lee' },
      ],
      isSearching: false,
      searchError: false,
      onSearchTextChange: () => undefined,
      onSelectMember: (selected) => { selectedId = selected.clerkUserId; },
      onClearSelection: () => undefined,
    }));
  });

  const input = renderer.root.findByProps({ role: 'combobox' });
  act(() => {
    input.props.onKeyDown({ key: 'ArrowDown', preventDefault: () => undefined });
  });
  act(() => {
    input.props.onKeyDown({ key: 'Enter', preventDefault: () => undefined });
  });
  assert.equal(selectedId, 'user_stable_456');
});