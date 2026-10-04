import { CalendarDays, ChartNoAxesCombined, MessageCircle, Zap } from 'lucide-react';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import './classic-hype-card-preview.css';

export function ClassicHypeCardPreview({ athleteName, teamName, photoUrl }: {
  athleteName: string;
  teamName: string;
  photoUrl: string | null;
}) {
  return (
    <div data-testid="classic-card-preview-stack">
      <div className="classic-card-preview-surface" data-testid="classic-card-preview-surface" role="img" aria-label={`Classic HYPE Card preview for ${athleteName}`}>
        <LivingAthleteCardFront athleteName={athleteName} teamName={teamName} photoUrl={photoUrl} appearance={{ design: 'classic' }} />
      </div>
      <div className="classic-card-preview-navigation" data-testid="appearance-navigation-preview" aria-hidden="true">
        <span><MessageCircle />Replies</span>
        <span><ChartNoAxesCombined />Stats</span>
        <span><Zap />Taps</span>
        <span><CalendarDays />Events</span>
      </div>
    </div>
  );
}