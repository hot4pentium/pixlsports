import { useId, useState } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { normalizeCardAppearance } from './hype-card-appearance';
import { buildPremiumNavStripPreview } from './premium-hype-card-artwork';
import './supporter-hype-card-preview.css';

type Props = {
  card?: OwnedAthleteInvite;
  href: string;
  reconnectionCandidates?: OwnedAthleteInvite[];
  onReconnect?: (card: OwnedAthleteInvite) => void;
  reconnectingToken?: string | null;
  reconnectError?: string;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
};

/** A saved front only: editing, flipping, and sharing stay on the full card. */
export function SupporterHypeCardPreview({
  card,
  href,
  reconnectionCandidates = [],
  onReconnect,
  reconnectingToken = null,
  reconnectError = '',
  loading,
  failed,
  onRetry,
}: Props) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const navId = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const unavailable = card?.paused || card?.showHypeCard === false;
  const appearance = card?.cardAppearance ? normalizeCardAppearance(card.cardAppearance) : null;
  const design = appearance?.design ?? 'classic';
  const spotlightNavigation = appearance?.design === 'spotlight'
    ? buildPremiumNavStripPreview(appearance, `saved${navId}`)
    : '';
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
          <p>
            {card?.paused
              ? 'Your card is paused.'
              : unavailable
                ? 'Your card is hidden.'
                : reconnectionCandidates.length
                  ? 'Your saved HYPE Card has different athlete details.'
                  : 'Your athlete’s card belongs here.'}
          </p>
          {reconnectionCandidates.length > 0 && (
            <div className="supporter-hype-preview__reconnect-options">
              <p>Choose the saved card for this athlete. Reconnecting changes its live name and team; its artwork and link stay the same.</p>
              {reconnectionCandidates.map((candidate) => (
                <div className="supporter-hype-preview__reconnect-card" key={candidate.inviteToken}>
                  <span>{candidate.athleteName} · {candidate.teamName || 'Team not set'}</span>
                  <button
                    type="button"
                    onClick={() => onReconnect?.(candidate)}
                    disabled={!onReconnect || Boolean(reconnectingToken)}
                    aria-label={`Reconnect ${candidate.athleteName}'s HYPE Card to the current athlete`}
                    data-testid={`button-reconnect-hype-card-${candidate.inviteToken}`}
                  >
                    {reconnectingToken === candidate.inviteToken ? 'Reconnecting…' : 'Reconnect'}
                  </button>
                </div>
              ))}
              {reconnectError && <p role="alert">{reconnectError}</p>}
            </div>
          )}
          <Link href="/studio/athlete-page">{card ? 'Manage card' : 'Set up card'}<ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      ) : (
        <Link href={href} className="supporter-hype-preview__link" aria-label={`View ${card.athleteName}'s HYPE Card`} data-testid="link-mobile-hype-preview">
          <div className="supporter-hype-preview__surface" data-design={design}>
            <LivingAthleteCardFront
              athleteName={card.athleteName}
              teamName={card.teamName}
              sport={card.sport}
              appearance={appearance}
              photoUrl={card.photoUrl === failedPhoto ? null : card.photoUrl}
              cutoutUrl={card.cutoutUrl}
              onPhotoError={() => setFailedPhoto(card.photoUrl)}
            />
          </div>
          {spotlightNavigation && (
            <div
              className="supporter-hype-preview__navigation"
              aria-hidden="true"
              data-testid="saved-card-navigation"
              dangerouslySetInnerHTML={{ __html: spotlightNavigation }}
            />
          )}
          <span className="supporter-hype-preview__open">View card<ArrowUpRight size={14} aria-hidden="true" /></span>
        </Link>
      )}
    </section>
  );
}