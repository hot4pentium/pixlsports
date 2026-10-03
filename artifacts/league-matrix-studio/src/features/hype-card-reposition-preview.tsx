import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { normalizeCardAppearance, type HypeCardAppearance } from './hype-card-appearance';

/** Repositioning is explicit so ordinary phone scrolling remains available. */
export function HypeCardRepositionPreview({ appearance, onChange, children }: {
  appearance: HypeCardAppearance;
  onChange: (next: HypeCardAppearance) => void;
  children: ReactNode;
}) {
  const [moving, setMoving] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!moving) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!moving || !drag.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const next = normalizeCardAppearance({
      ...appearance,
      athleteX: appearance.athleteX + (event.clientX - drag.current.x) / rect.width,
      athleteY: appearance.athleteY + (event.clientY - drag.current.y) / rect.height,
    });
    drag.current = { x: event.clientX, y: event.clientY };
    onChange(next);
  };
  return (
    <div>
      <div className="mx-auto aspect-[5/7] w-full max-w-[320px]"
        style={{ touchAction: moving ? 'none' : 'auto', cursor: moving ? 'grab' : 'auto' }}
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <div className="h-full w-full" style={{ pointerEvents: moving ? 'none' : 'auto' }}>{children}</div>
      </div>
      <button type="button" aria-pressed={moving}
        onClick={() => { drag.current = null; setMoving(value => !value); }}
        className="mt-3 min-h-11 rounded border border-white/30 px-4 text-xs font-bold text-white">
        {moving ? 'Done moving' : 'Move athlete'}
      </button>
      <p className="mt-2 text-xs text-white/70">
        {moving ? 'Drag the preview to move the athlete. Choose Done moving to scroll.' : 'Placement matches your saved and exported card.'}
      </p>
    </div>
  );
}