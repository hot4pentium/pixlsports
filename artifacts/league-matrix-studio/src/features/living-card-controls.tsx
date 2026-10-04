import { CalendarDays, ChartNoAxesCombined, Zap } from 'lucide-react';

export type CardSide = 'front' | 'responses' | 'stats' | 'events' | 'live-taps';

type ControlSide = Exclude<CardSide, 'front'>;

type Props = {
  side?: CardSide;
  eventToday?: boolean;
  eventCount?: number;
  onSelectSide?: (next: CardSide) => void;
  decorative?: boolean;
};

const controls: Array<{
  side: ControlSide;
  label: string;
  ariaLabel?: string;
  testId: string;
}> = [
  { side: 'responses', label: 'Replies', ariaLabel: 'Responses', testId: 'button-living-card-responses' },
  { side: 'stats', label: 'Stats', testId: 'button-living-card-stats' },
  { side: 'live-taps', label: 'Taps', ariaLabel: 'Live Taps', testId: 'button-living-card-live-taps' },
  { side: 'events', label: 'Events', testId: 'button-living-card-events' },
];

function ControlIcon({ side }: { side: ControlSide }) {
  if (side === 'responses') return <span className="living-card-control-emoji" aria-hidden="true">👍</span>;
  if (side === 'stats') return <ChartNoAxesCombined aria-hidden="true" />;
  if (side === 'live-taps') return <Zap aria-hidden="true" />;
  return <CalendarDays aria-hidden="true" />;
}

export function LivingCardControls({
  side = 'front',
  eventToday = false,
  eventCount = 0,
  onSelectSide,
  decorative = false,
}: Props) {
  const content = (control: (typeof controls)[number]) => (
    <>
      <ControlIcon side={control.side} />
      {control.label}
      {control.side === 'events' && eventCount > 0 && <span className="living-card-control-count">({eventCount})</span>}
      {control.side === 'events' && eventToday && <span className="sr-only"> · Event today</span>}
    </>
  );

  return (
    <div
      className="living-card-controls"
      role={decorative ? undefined : 'group'}
      aria-label={decorative ? undefined : 'Choose a side of the athlete card'}
      aria-hidden={decorative || undefined}
    >
      {controls.map((control) => {
        const className = `living-card-control${control.side === 'events' && eventToday ? ' living-card-control-today' : ''}`;
        if (decorative) {
          return <span key={control.side} className={className}>{content(control)}</span>;
        }
        return (
          <button
            key={control.side}
            type="button"
            className={className}
            aria-label={control.ariaLabel}
            aria-pressed={side === control.side}
            aria-controls="living-card-display"
            onClick={() => onSelectSide?.(control.side)}
            data-testid={control.testId}
          >
            {content(control)}
          </button>
        );
      })}
    </div>
  );
}