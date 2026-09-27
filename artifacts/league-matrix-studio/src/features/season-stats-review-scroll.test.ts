import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { act, create } from 'react-test-renderer';
import { useSeasonStatsReviewScroll } from './season-stats-review-scroll';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ReviewHarness({ initialGameId = null }: { initialGameId?: string | null }) {
  const [selectedGameId, setSelectedGameId] = useState<string | null>(initialGameId);
  const { detailRef, showReview } = useSeasonStatsReviewScroll(selectedGameId, 'game-1');
  return createElement('div', null,
    createElement('button', {
      onClick: () => {
        if (selectedGameId === 'game-1') showReview();
        else setSelectedGameId('game-1');
      },
    }, 'Review game'),
    createElement('article', { ref: detailRef, tabIndex: -1 }, 'Game report'),
  );
}

test('game selection scrolls and focuses its review, including repeated clicks and deep links', async () => {
  const focusCalls: unknown[] = [];
  const scrollCalls: ScrollIntoViewOptions[] = [];
  const article = {
    focus: (options: unknown) => { focusCalls.push(options); },
    scrollIntoView: (options: ScrollIntoViewOptions) => { scrollCalls.push(options); },
  };
  const createNodeMock = ({ type }: { type: unknown }) => type === 'article' ? article : null;
  let renderer!: ReturnType<typeof create>;

  await act(async () => {
    renderer = create(createElement(ReviewHarness), { createNodeMock });
  });
  assert.equal(scrollCalls.length, 0);
  await act(async () => renderer.root.findByType('button').props.onClick());
  assert.deepEqual(focusCalls[0], { preventScroll: true });
  assert.deepEqual(scrollCalls[0], { behavior: 'smooth', block: 'start', inline: 'nearest' });
  await act(async () => renderer.root.findByType('button').props.onClick());
  assert.equal(scrollCalls.length, 2);
  await act(async () => renderer.unmount());

  await act(async () => {
    renderer = create(createElement(ReviewHarness, { initialGameId: 'game-1' }), { createNodeMock });
  });
  assert.equal(scrollCalls.length, 3);
  await act(async () => renderer.unmount());
});