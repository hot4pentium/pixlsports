import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import './supporter-hype-card-preview.css';

type Props = {
  card?: OwnedAthleteInvite;
  href: string;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
};

/** A saved front only: editing, flipping, and sharing stay on the full card. */
export function SupporterHypeCardPreview({ card, href, loading, failed, onRetry }: Props) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const unavailable = card?.paused || card?.showHypeCard === false;
  const design = card?.cardAppearance?.design ?? 'classic';
  return (
    <section className="supporter-hype-preview" aria-label="Saved HYPE Card" data-testid="mobile-saved-hype-card">
      <span className="supporter-hype-preview__label">HYPE CARD</span>
      {loading ? (
        <div className="supporter-hype-preview__state" role="status">
          <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          <p>Loading your card…</p>
        </div>
      ) : failed ? (
        <div className="supporter-hype-preview__state" role="status">
          <p>Your card couldn’t load.</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : !card || unavailable ? (
        <div className="supporter-hype-preview__state">
          <p>{card?.paused ? 'Your card is paused.' : unavailable ? 'Your card is hidden.' : 'Your athlete’s card belongs here.'}</p>
          <Link href="/studio/athlete-page">{card ? 'Manage card' : 'Set up card'}<ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      ) : (
        <Link href={href} className="supporter-hype-preview__link" aria-label={`View ${card.athleteName}'s HYPE Card`} data-testid="link-mobile-hype-preview">
          <div className="supporter-hype-preview__surface" data-design={design}>
            <LivingAthleteCardFront
              athleteName={card.athleteName}
              teamName={card.teamName}
              sport={card.sport}
              appearance={card.cardAppearance}
              photoUrl={card.photoUrl === failedPhoto ? null : card.photoUrl}
              cutoutUrl={card.cutoutUrl}
              onPhotoError={() => setFailedPhoto(card.photoUrl)}
            />
          </div>
          <span className="supporter-hype-preview__open">View card<ArrowUpRight size={14} aria-hidden="true" /></span>
        </Link>
      )}
    </section>
  );
}