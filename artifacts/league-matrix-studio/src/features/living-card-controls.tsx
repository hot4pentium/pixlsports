import { CalendarDays, ChartNoAxesCombined, RectangleVertical, SquarePlay, ThumbsUp, Zap } from 'lucide-react';
import type { CardSide, PrimaryCardSide, SecondaryCardSide } from './hype-card-flip-model';

export type { CardSide } from './hype-card-flip-model';

type Props = {
  side?: CardSide;
  tabs?: PrimaryCardSide[];
  eventToday?: boolean;
  eventCount?: number;
  liveScoreboardAvailable?: boolean;
  onSelectSide?: (next: CardSide) => void;
  decorative?: boolean;
};

const labels: Record<PrimaryCardSide, string> = { front: 'Front', videos: 'Videos', stats: 'Stats', events: 'Events' };

function TabIcon({ side }: { side: PrimaryCardSide }) {
  if (side === 'front') return <RectangleVertical aria-hidden="true" />;
  if (side === 'videos') return <SquarePlay aria-hidden="true" />;
  if (side === 'stats') return <ChartNoAxesCombined aria-hidden="true" />;
  return <CalendarDays aria-hidden="true" />;
}

/** Attached section tabs, matching the native HYPE Card tab bar. */
export function LivingCardControls({
  side = 'front',
  tabs = ['front', 'videos', 'stats', 'events'],
  eventToday = false,
  eventCount = 0,
  liveScoreboardAvailable = false,
  onSelectSide,
  decorative = false,
}: Props) {
  return (
    <div
      className="living-card-controls"
      role={decorative ? undefined : 'group'}
      aria-label={decorative ? undefined : 'HYPE Card sections'}
      aria-hidden={decorative || undefined}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const live = tab === 'stats' && liveScoreboardAvailable;
        const className = [
          'living-card-control',
          tab === 'events' && eventToday ? 'living-card-control-today' : '',
          live ? 'living-card-control-live' : '',
        ].filter(Boolean).join(' ');
        const content = (
          <>
            <TabIcon side={tab} />
            <span>{labels[tab]}</span>
            {tab === 'events' && eventCount > 0 && <span className="sr-only"> ({eventCount})</span>}
            {tab === 'events' && eventToday && <span className="sr-only"> · Event today</span>}
            {live && <span className="sr-only"> · Live scoreboard available</span>}
          </>
        );
        if (decorative) return <span key={tab} className={className}>{content}</span>;
        return (
          <button
            key={tab}
            type="button"
            className={className}
            aria-label={live ? `Stats, Live scoreboard available` : undefined}
            aria-pressed={side === tab}
            aria-controls="living-card-display"
            onClick={() => onSelectSide?.(tab)}
            data-testid={`button-living-card-${tab}`}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

/** Secondary sides kept for Shoutouts and private family Live Taps. */
export function LivingCardSecondarySides({
  side,
  liveTapsActive = false,
  onSelectSide,
}: { side: CardSide; liveTapsActive?: boolean; onSelectSide: (next: SecondaryCardSide) => void }) {
  const items: Array<{ id: SecondaryCardSide; label: string; detail: string }> = [
    { id: 'responses', label: 'Shoutouts', detail: 'Public cheers from fans' },
    { id: 'live-taps', label: 'Live Taps', detail: liveTapsActive ? 'Game Day Live is active' : 'Family cheer tally' },
  ];
  return (
    <div className="living-card-secondary-sides" role="group" aria-label="More from this card">
      {items.map((item) => {
        const live = item.id === 'live-taps' && liveTapsActive;
        return (
          <button
            key={item.id}
            type="button"
            className={`living-card-control living-card-secondary-side${live ? ' living-card-control-live' : ''}`}
            aria-pressed={side === item.id}
            aria-controls="living-card-display"
            aria-label={item.id === 'responses' ? 'Responses' : live ? 'Live Taps, Game Day Live is active' : 'Live Taps'}
            onClick={() => onSelectSide(item.id)}
            data-testid={`button-living-card-${item.id}`}
          >
            {item.id === 'responses' ? <ThumbsUp aria-hidden="true" /> : <Zap aria-hidden="true" />}
            <span className="living-card-secondary-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
          </button>
        );
      })}
    </div>
  );
}
