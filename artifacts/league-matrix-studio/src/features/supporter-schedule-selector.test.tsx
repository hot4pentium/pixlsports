import assert from 'node:assert/strict';
import test from 'node:test';
import { act, create, type ReactTestRenderer, type ReactTestRendererNode } from 'react-test-renderer';
import { createElement } from 'react';

import {
  readSupporterScheduleSelection,
  saveSupporterScheduleSelection,
} from './schedule-draft';
import { SupporterScheduleSelector, type SupporterScheduleSelectorProps } from './supporter-schedule-selector';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const schedules = [
  {
    id: 'latest',
    label: 'Wildcats · Fall 2026',
    teamName: 'Wildcats',
    season: 'Fall 2026',
    updatedAt: '2026-09-15T12:00:00Z',
    eventCount: 3,
  },
  {
    id: 'older',
    label: 'Wildcats · Spring 2026',
    teamName: 'Wildcats',
    season: 'Spring 2026',
    updatedAt: '2026-09-10T12:00:00Z',
    eventCount: 2,
  },
];

function findSelect(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ 'data-testid': 'select-saved-custom-schedule' });
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

test('supporter schedule selector lets a supporter choose an older saved schedule and keeps it after reload', () => {
  const storage = new MemoryStorage();
  let selectedScheduleId = readSupporterScheduleSelection(storage as unknown as Storage);
  let renderer!: ReactTestRenderer;
  const renderProps = (): SupporterScheduleSelectorProps => ({
    schedules,
    selectedScheduleId,
    connected: false,
    onSelect: (scheduleId) => {
      selectedScheduleId = scheduleId;
      saveSupporterScheduleSelection(storage as unknown as Storage, scheduleId);
    },
  });

  act(() => {
    renderer = create(createElement(SupporterScheduleSelector, renderProps()));
  });
  assert.equal(findSelect(renderer).props.value, 'latest');

  act(() => {
    findSelect(renderer).props.onChange({ target: { value: 'older' } });
  });
  act(() => {
    renderer.update(createElement(SupporterScheduleSelector, renderProps()));
  });
  assert.equal(readSupporterScheduleSelection(storage as unknown as Storage), 'older');
  assert.equal(findSelect(renderer).props.value, 'older');

  selectedScheduleId = readSupporterScheduleSelection(storage as unknown as Storage);
  act(() => {
    renderer.update(createElement(SupporterScheduleSelector, renderProps()));
  });
  assert.equal(findSelect(renderer).props.value, 'older');
});

test('selector keeps connected team calendar guidance visible while custom choice is preserved', () => {
  let selectedScheduleId: string | null = 'older';
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(createElement(SupporterScheduleSelector, {
      schedules,
      selectedScheduleId,
      connected: true,
      onSelect: (scheduleId: string) => {
        selectedScheduleId = scheduleId;
      },
    }));
  });

  const select = findSelect(renderer);
  assert.equal(select.props.value, 'older');
  assert.deepEqual(select.findAllByType('option').map((option) => option.props.value), ['latest', 'older']);
  assert.match(renderedText(renderer), /Your connected team calendar is currently shown first/);
});