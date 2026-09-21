import assert from 'node:assert/strict';
import test from 'node:test';
import { act, create } from 'react-test-renderer';
import { createElement } from 'react';

import { readSupporterScheduleSelection, saveSupporterScheduleSelection } from './schedule-draft';
import { SupporterScheduleSelector } from './supporter-schedule-selector';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const schedules = [
  { id: 'latest', label: 'Wildcats · Fall 2026', teamName: 'Wildcats', season: 'Fall 2026', updatedAt: '2026-09-15', eventCount: 3 },
  { id: 'older', label: 'Wildcats · Spring 2026', teamName: 'Wildcats', season: 'Spring 2026', updatedAt: '2026-09-10', eventCount: 2 },
];

test('supporters can select and persist a custom saved schedule', () => {
  const storage = new MemoryStorage();
  let selected = readSupporterScheduleSelection(storage as unknown as Storage);
  let renderer: ReturnType<typeof create>;
  const render = () => createElement(SupporterScheduleSelector, {
    schedules,
    selectedScheduleId: selected,
    onSelect: (id: string) => {
      selected = id;
      saveSupporterScheduleSelection(storage as unknown as Storage, id);
    },
  });
  act(() => { renderer = create(render()); });
  const select = renderer!.root.findByProps({ 'data-testid': 'select-saved-custom-schedule' });
  act(() => { select.props.onChange({ target: { value: 'older' } }); });
  assert.equal(readSupporterScheduleSelection(storage as unknown as Storage), 'older');
});