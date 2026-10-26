import { CalendarDays, ChartNoAxesCombined, ThumbsUp, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { normalizeCardAppearance, type HypeCardAppearance } from './hype-card-appearance';
import './classic-hype-card-preview.css';

export function HypeCardPreviewNavigation({ cardHref }: { cardHref?: string }) {
  const items = [[ThumbsUp, 'Replies', 'responses'], [ChartNoAxesCombined, 'Stats', 'stats'], [Zap, 'Taps', 'live-taps'], [CalendarDays, 'Events', 'events']] as const;
  return (
    <div className="classic-card-preview-navigation" data-testid="appearance-navigation-preview" role="group" aria-label="HYPE Card sections">
      {items.map(([Icon, label, side]) => cardHref
        ? <Link key={label} href={`${cardHref}?side=${side}`} target="_blank" rel="noopener noreferrer" aria-label={`Open saved card ${label.toLowerCase()} in a new tab`} data-testid={`link-preview-flip-${label.toLowerCase()}`} data-preview-side={side}><Icon aria-hidden="true" />{label}</Link>
        : <span key={label} data-preview-side={side}><Icon aria-hidden="true" />{label}</span>)}
    </div>
  );
}

export function ClassicHypeCardPreview({ athleteName, teamName, photoUrl, appearance, cardHref }: {
  athleteName: string;
  teamName: string;
  photoUrl: string | null;
  appearance?: Partial<HypeCardAppearance> | null;
  cardHref?: string;
}) {
  const cardAppearance = normalizeCardAppearance(appearance);
  return (
    <div data-testid="classic-card-preview-stack">
      <div className="classic-card-preview-surface" data-testid="classic-card-preview-surface" data-design={cardAppearance.design} role="img" aria-label={`HYPE Card preview for ${athleteName}`} style={{ aspectRatio: '3 / 4', position: 'relative' }}>
        <LivingAthleteCardFront athleteName={athleteName} teamName={teamName} photoUrl={photoUrl} appearance={cardAppearance} />
      </div>
      <HypeCardPreviewNavigation cardHref={cardHref} />
    </div>
  );
}
