import { useRef, type PointerEvent, type ReactNode } from 'react';
import { normalizeCardAppearance, type HypeCardAppearance } from './hype-card-appearance';

/** Repositioning is explicit so ordinary phone scrolling remains available. */
export function HypeCardRepositionPreview({ appearance, onChange, children, moving }: {
  appearance: HypeCardAppearance;
  onChange: (next: HypeCardAppearance) => void;
  children: ReactNode;
  moving: boolean;
}) {
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
    <div
      className="h-full w-full"
      tabIndex={moving ? 0 : undefined}
      role={moving ? 'group' : undefined}
      aria-label={moving ? 'Position photo preview. Use arrow keys to move the photo.' : undefined}
      data-testid="hype-card-positioning-preview"
      data-position-x={appearance.athleteX}
      data-position-y={appearance.athleteY}
      onKeyDown={(event) => {
        if (!moving) return;
        const directions: Record<string, [number, number]> = { ArrowLeft: [-.01, 0], ArrowRight: [.01, 0], ArrowUp: [0, -.01], ArrowDown: [0, .01] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        onChange(normalizeCardAppearance({ ...appearance, athleteX: appearance.athleteX + direction[0], athleteY: appearance.athleteY + direction[1] }));
      }}
      style={{ touchAction: moving ? 'none' : 'auto', cursor: moving ? 'grab' : 'auto' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <div className="h-full w-full" style={{ pointerEvents: moving ? 'none' : 'auto' }}>{children}</div>
    </div>
  );
}