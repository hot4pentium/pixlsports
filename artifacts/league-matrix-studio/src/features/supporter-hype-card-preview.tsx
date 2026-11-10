import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from 'wouter';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import { LivingAthleteCardFront, NativeHypeCardFront } from './living-athlete-card-front';
import { normalizeCardAppearance } from './hype-card-appearance';
import './supporter-hype-card-preview.css';

type Props = {
  placement?: 'mobile' | 'desktop';
  card?: OwnedAthleteInvite;
  targetAthleteName: string;
  targetTeamName: string;
  href: string;
  manageHref?: string;
  reconnectionCandidates?: OwnedAthleteInvite[];
  onReconnect?: (card: OwnedAthleteInvite) => Promise<boolean>;
  reconnectingToken?: string | null;
  reconnectError?: string;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
};

/** The iOS-style front only; the dashboard card opens the owner Showcase. */
export function SupporterHypeCardPreview({
  placement = 'mobile',
  card,
  targetAthleteName,
  targetTeamName,
  manageHref = '/studio/player-showcase',
  reconnectionCandidates = [],
  onReconnect,
  reconnectingToken = null,
  reconnectError = '',
  loading,
  failed,
  onRetry,
}: Props) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [pendingReconnect, setPendingReconnect] = useState<OwnedAthleteInvite | null>(null);
  const unavailable = card?.paused || card?.showHypeCard === false;
  const appearance = card?.cardAppearance ? normalizeCardAppearance(card.cardAppearance) : null;
  const isMobile = placement === 'mobile';
  const testIdPrefix = isMobile ? 'mobile' : 'desktop';

  const confirmReconnect = async () => {
    if (!pendingReconnect || !onReconnect) return;
    const reconnected = await onReconnect(pendingReconnect);
    if (reconnected) setPendingReconnect(null);
  };

  return (
    <>
      <section
        className={`supporter-hype-preview${isMobile ? '' : ' supporter-hype-preview--desktop'}`}
        aria-label="Saved HYPE Card"
        data-testid={isMobile ? 'mobile-saved-hype-card' : 'desktop-saved-hype-card'}
      >
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
          <div className="supporter-hype-preview__state supporter-hype-preview__state--empty">
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
                      onClick={() => setPendingReconnect(candidate)}
                      disabled={!onReconnect || Boolean(reconnectingToken)}
                      aria-label={`Reconnect ${candidate.athleteName}'s HYPE Card to the current athlete`}
                      data-testid={`${isMobile ? 'button-reconnect-hype-card' : 'button-reconnect-hype-card-desktop'}-${candidate.inviteToken}`}
                    >
                      Reconnect
                    </button>
                  </div>
                ))}
                {reconnectError && <p role="alert">{reconnectError}</p>}
              </div>
            )}
            <p className="text-xs text-white/70">Open Player Showcase to set up, view, and manage your HYPE Card.</p>
            <Link
              href={manageHref}
              className="supporter-hype-preview__open-showcase"
              data-testid={`${testIdPrefix}-hype-preview-open-showcase`}
            >
              Open Player Showcase
            </Link>
          </div>
        ) : (
          <div className="supporter-hype-preview__card-wrap">
            <Link
              href={manageHref}
              className="supporter-hype-preview__link"
              aria-label={`${card.athleteName}'s HYPE Card preview`}
              data-testid={isMobile ? 'link-mobile-hype-preview' : 'link-desktop-hype-preview'}
            >
              <div className="supporter-hype-preview__surface">
                <NativeHypeCardFront
                  athleteName={card.athleteName}
                  teamName={card.teamName}
                  seasonName={card.seasonName}
                  appearance={appearance}
                  photoUrl={card.photoUrl === failedPhoto ? null : card.photoUrl}
                  onPhotoError={() => setFailedPhoto(card.photoUrl)}
                />
              </div>
            </Link>
          </div>
        )}
      </section>
    <Dialog
      open={Boolean(pendingReconnect)}
      onOpenChange={(open) => {
        if (!open && pendingReconnect?.inviteToken !== reconnectingToken) setPendingReconnect(null);
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-md border-[#55A4FF]/35 bg-[#0B1F3A] p-5 text-white shadow-2xl sm:rounded-xl"
        data-testid={`${testIdPrefix}-hype-card-reconnect-review`}
      >
        <DialogHeader className="pr-7 text-left">
          <DialogTitle className="font-display text-2xl uppercase tracking-wide text-white">
            Reconnect this HYPE Card?
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-white/75">
            Review the saved card and the profile it will be linked to. This changes the card’s athlete and team details only.
          </DialogDescription>
        </DialogHeader>
        {pendingReconnect && (
          <div className="grid gap-4">
            <div className="mx-auto w-28 overflow-hidden rounded-lg border border-white/20" data-testid="reconnect-card-artwork">
              <LivingAthleteCardFront
                athleteName={pendingReconnect.athleteName}
                teamName={pendingReconnect.teamName}
                sport={pendingReconnect.sport}
                appearance={pendingReconnect.cardAppearance ? normalizeCardAppearance(pendingReconnect.cardAppearance) : null}
                photoUrl={pendingReconnect.photoUrl}
                cutoutUrl={pendingReconnect.cutoutUrl}
                photoAlt={`Saved HYPE Card for ${pendingReconnect.athleteName}`}
              />
            </div>
            <dl className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm">
              <div>
                <dt className="text-[10px] font-black uppercase tracking-[.15em] text-[#8EC4FF]">Saved card</dt>
                <dd className="mt-1 font-semibold">{pendingReconnect.athleteName} · {pendingReconnect.teamName || 'Team not set'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-black uppercase tracking-[.15em] text-[#8EC4FF]">Reconnect to profile</dt>
                <dd className="mt-1 font-semibold">{targetAthleteName} · {targetTeamName}</dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-white/70">
              The existing public link and card design will stay the same. No other athlete’s card will be changed unless you confirm this exact card.
            </p>
            {reconnectError && <p role="alert" className="text-sm text-red-200">{reconnectError}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingReconnect(null)}
                disabled={reconnectingToken === pendingReconnect.inviteToken}
                className="min-h-11 rounded-md border border-white/25 px-4 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 disabled:opacity-50"
                data-testid={`${testIdPrefix}-button-cancel-hype-card-reconnect`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void confirmReconnect(); }}
                disabled={!onReconnect || Boolean(reconnectingToken)}
                className="min-h-11 rounded-md bg-[#8EC4FF] px-4 text-xs font-black uppercase tracking-widest text-[#071A31] hover:bg-[#B8DCFF] disabled:opacity-50"
                data-testid={`${testIdPrefix}-button-confirm-hype-card-reconnect`}
              >
                {reconnectingToken === pendingReconnect.inviteToken ? 'Reconnecting…' : 'Confirm reconnect'}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}