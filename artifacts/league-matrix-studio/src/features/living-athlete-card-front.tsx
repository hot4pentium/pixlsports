import { useEffect, useId, useMemo, useState } from 'react';
import './premium-hype-card.css';
import { normalizeCardAppearance, type HypeCardAppearance } from './hype-card-appearance';
import { buildBrandedPremiumHypeCardArtwork } from './premium-hype-card-brand';
import './living-athlete-card.css';

export type LivingAthleteCardFrontProps = {
  athleteName: string;
  teamName?: string | null;
  photoUrl?: string | null;
  photoAlt?: string;
  onPhotoError?: () => void;
  appearance?: Partial<HypeCardAppearance> | null;
  sport?: string;
  cutoutUrl?: string | null;
};

export function LivingAthleteCardFront({
  athleteName,
  teamName,
  photoUrl,
  photoAlt,
  onPhotoError,
  appearance,
  sport,
  cutoutUrl,
}: LivingAthleteCardFrontProps) {
  const [failedCutout, setFailedCutout] = useState<string | null>(null);
  useEffect(() => {
    if (!cutoutUrl || !appearance || appearance.design === 'classic') return;
    let live = true;
    const probe = new Image();
    probe.onerror = () => { if (live) setFailedCutout(cutoutUrl); };
    probe.src = cutoutUrl;
    return () => { live = false; };
  }, [cutoutUrl, appearance]);
  const safeCutout = cutoutUrl && failedCutout !== cutoutUrl ? cutoutUrl : null;
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const normalized = useMemo(() => (appearance ? normalizeCardAppearance(appearance) : null), [appearance]);
  const premium = normalized && normalized.design !== 'classic' ? normalized : null;
  const svg = useMemo(() => premium ? buildBrandedPremiumHypeCardArtwork({
    athleteName, teamName, sport, jerseyNumber: premium.jerseyNumber, position: premium.position,
    photoUrl, cutoutUrl: safeCutout, appearance: premium,
  }, 'all', `lc${uid}`) : '', [premium, athleteName, teamName, sport, photoUrl, safeCutout, uid]);
  if (premium) {
    return (
      <div className="living-card-face living-card-premium-face" key="front" data-design={premium.design}>
        <div className="living-card-premium-art" role="img" aria-label={`${athleteName} ${premium.design} HYPE Card`} data-testid="img-living-card-athlete" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    );
  }
  return (
    <div className="living-card-face" key="front">
      {photoUrl ? (
        <img className="living-card-photo" src={photoUrl} alt={photoAlt ?? `Portrait of ${athleteName}`} onError={onPhotoError} data-testid="img-living-card-athlete" />
      ) : (
        <div className="living-card-photo-fallback" aria-label="No athlete portrait selected yet">
          <span aria-hidden="true">{athleteName.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'P'}</span>
          <small>Portrait coming soon</small>
        </div>
      )}
      <div className="living-card-photo-shade" />
      {photoUrl && (
        <span className="living-card-photo-watermark" aria-hidden="true">HYPE CARD</span>
      )}
      <div className="living-card-front-identity">
        <h2 className="living-card-athlete-name" data-testid="text-living-card-athlete-name">{athleteName}</h2>
        {teamName && <p className="living-card-team-name" data-testid="text-living-card-team-name">{teamName}</p>}
      </div>
    </div>
  );
}