import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Copy, Loader2, Share2 } from 'lucide-react';
import QRCode from 'qrcode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { normalizeCardAppearance } from './hype-card-appearance';
import './supporter-hype-card-preview.css';

type Props = {
  placement?: 'mobile' | 'desktop';
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
  placement = 'mobile',
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
  const [shareOpen, setShareOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const shareLinkInputRef = useRef<HTMLInputElement>(null);
  const unavailable = card?.paused || card?.showHypeCard === false;
  const appearance = card?.cardAppearance ? normalizeCardAppearance(card.cardAppearance) : null;
  const design = appearance?.design ?? 'classic';
  const isMobile = placement === 'mobile';
  const testIdPrefix = isMobile ? 'mobile' : 'desktop';
  const shareOrigin = typeof window === 'undefined'
    ? ''
    : ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
      ? 'https://pixlsports.com'
      : window.location.origin;
  const shareUrl = shareOrigin ? new URL(href, shareOrigin).toString() : href;

  useEffect(() => {
    if (!shareOpen || loading || failed || !card || unavailable) return;

    let current = true;
    setQrDataUrl('');
    setQrError('');
    setCopyMessage('');
    void QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: 'Q',
      margin: 3,
      width: 360,
      color: { dark: '#07172b', light: '#ffffff' },
    }).then((dataUrl) => {
      if (current) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (current) setQrError('The QR code could not be created. You can still copy the link.');
    });

    return () => { current = false; };
  }, [card, failed, href, loading, shareOpen, shareUrl, unavailable]);

  useEffect(() => {
    if (loading || failed || !card || unavailable) setShareOpen(false);
  }, [card, failed, loading, unavailable]);

  const copyShareLink = async () => {
    setCopyMessage('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage('Link copied.');
    } catch {
      shareLinkInputRef.current?.focus();
      shareLinkInputRef.current?.select();
      setCopyMessage('Could not copy automatically. The link is selected so you can copy it.');
    }
  };

  return (
    <Dialog open={shareOpen} onOpenChange={setShareOpen}>
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
                      data-testid={`${isMobile ? 'button-reconnect-hype-card' : 'button-reconnect-hype-card-desktop'}-${candidate.inviteToken}`}
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
          <div className="supporter-hype-preview__card-wrap">
            <Link
              href={href}
              className="supporter-hype-preview__link"
              aria-label={`View ${card.athleteName}'s HYPE Card`}
              data-testid={isMobile ? 'link-mobile-hype-preview' : 'link-desktop-hype-preview'}
            >
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
            </Link>
            <DialogTrigger asChild>
              <button
                type="button"
                className="supporter-hype-preview__share-trigger"
                aria-label={`Share ${card.athleteName}'s HYPE Card`}
                data-testid={`button-${testIdPrefix}-hype-card-share`}
              >
                <Share2 size={15} strokeWidth={2.5} aria-hidden="true" />
                <span>Share</span>
              </button>
            </DialogTrigger>
          </div>
        )}
      </section>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-md border-[#55A4FF]/35 bg-[#0B1F3A] p-5 text-white shadow-2xl sm:rounded-xl"
        data-testid={`dialog-${testIdPrefix}-hype-card-share`}
      >
        <DialogHeader className="pr-7 text-left">
          <DialogTitle className="font-display text-2xl uppercase tracking-wide text-white">
            Share {card?.athleteName ? `${card.athleteName}’s` : 'your athlete’s'} HYPE Card
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-white/75">
            Anyone with this public link can view the HYPE Card. Copy the link or scan the code to open it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid justify-items-center gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="grid min-h-48 min-w-48 place-items-center rounded-lg bg-white p-2" data-testid={`panel-${testIdPrefix}-hype-card-qr`}>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code for ${card?.athleteName ?? 'your athlete'}'s public HYPE Card`}
                className="block h-44 w-44"
                data-testid={`img-${testIdPrefix}-hype-card-qr`}
              />
            ) : qrError ? (
              <p role="alert" className="max-w-40 p-3 text-center text-xs font-semibold text-[#071A31]">{qrError}</p>
            ) : (
              <div role="status" className="flex items-center gap-2 p-3 text-xs font-semibold text-[#071A31]">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Preparing QR code…
              </div>
            )}
          </div>
          <div className="w-full min-w-0">
            <label htmlFor={`input-${testIdPrefix}-hype-card-share-link`} className="mb-2 block text-[10px] font-black uppercase tracking-[0.15em] text-[#8EC4FF]">
              HYPE Card link
            </label>
            <input
              ref={shareLinkInputRef}
              id={`input-${testIdPrefix}-hype-card-share-link`}
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 w-full min-w-0 rounded-md border border-white/20 bg-black/20 px-3 text-xs font-medium text-white"
              data-testid={`input-${testIdPrefix}-hype-card-share-link`}
            />
            <button
              type="button"
              onClick={() => { void copyShareLink(); }}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8EC4FF] px-4 text-xs font-black uppercase tracking-widest text-[#071A31] transition-colors hover:bg-[#B8DCFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              data-testid={`button-${testIdPrefix}-copy-hype-card-link`}
            >
              <Copy size={15} aria-hidden="true" />
              Copy link
            </button>
            <p role="status" aria-live="polite" className="mt-2 min-h-4 text-center text-xs text-white/75" data-testid={`text-${testIdPrefix}-hype-card-copy-status`}>
              {copyMessage}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}