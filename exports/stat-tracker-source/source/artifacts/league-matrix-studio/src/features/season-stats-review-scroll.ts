import { useCallback, useEffect, useRef } from 'react';

export function useSeasonStatsReviewScroll(selectedGameId: string | null, visibleGameId: string | null) {
  const detailRef = useRef<HTMLElement>(null);
  const showReview = useCallback(() => {
    const detail = detailRef.current;
    if (!detail) return;
    detail.focus({ preventScroll: true });
    detail.scrollIntoView({
      behavior: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
      inline: 'nearest',
    });
  }, []);

  useEffect(() => {
    if (selectedGameId && selectedGameId === visibleGameId) showReview();
  }, [selectedGameId, visibleGameId, showReview]);

  return { detailRef, showReview };
}