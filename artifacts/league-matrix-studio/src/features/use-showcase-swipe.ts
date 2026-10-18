import { useRef, type PointerEvent } from 'react';

type ShowcaseSlide = 'jersey' | 'card';

const SWIPE_THRESHOLD = 52;

export function useShowcaseSwipe(setSlide: (slide: ShowcaseSlide) => void) {
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target instanceof Element && event.target.closest('a,button,input,select,textarea,[contenteditable="true"]')) return;
    start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const origin = start.current;
    start.current = null;
    if (!origin || origin.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - origin.x;
    const deltaY = event.clientY - origin.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;

    setSlide(deltaX < 0 ? 'card' : 'jersey');
  }

  function onPointerCancel() {
    start.current = null;
  }

  return { onPointerDown, onPointerUp, onPointerCancel };
}
