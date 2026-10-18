import { useEffect, useId, useMemo, useState } from 'react';
import { normalizeCardAppearance, type HypeCardAppearance } from './hype-card-appearance';
import { buildBrandedSimpleArtwork } from './simple-hype-card-brand';
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

export function LivingAthleteCardFront({ athleteName, teamName, photoUrl, photoAlt, onPhotoError, appearance }: LivingAthleteCardFrontProps) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const a = useMemo(() => normalizeCardAppearance(appearance ?? {}), [appearance]);
  const style = a.lowerThirdStyle;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const usablePhoto = photoUrl === failedPhoto ? null : photoUrl;
  useEffect(() => {
    if (!photoUrl) return;
    let live = true;
    const probe = new Image();
    probe.onerror = () => { if (live) { setFailedPhoto(photoUrl); onPhotoError?.(); } };
    probe.src = photoUrl;
    return () => { live = false; };
  }, [photoUrl, onPhotoError]);
  const svg = useMemo(() => buildBrandedSimpleArtwork({
    athleteName, teamName, jerseyNumber: a.jerseyNumber, position: a.position, photoUrl: usablePhoto, lowerThirdStyle: style,
    athleteX: a.athleteX, athleteY: a.athleteY,
  }, `lc${uid}`), [athleteName, teamName, a.jerseyNumber, a.athleteX, a.athleteY, usablePhoto, style, uid]);
  return (
    <div className="living-card-face living-card-simple-face" key="front" data-design="classic">
      <div className="living-card-simple-art" role="img" aria-label={photoAlt ?? `${athleteName} HYPE Card`} data-testid="img-living-card-athlete" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="sr-only" data-testid="text-living-card-athlete-name">{athleteName}</span>
      {teamName && <span className="sr-only" data-testid="text-living-card-team-name">{teamName}</span>}
      {a.jerseyNumber && <span className="sr-only" data-testid="text-living-card-jersey-number">Number {a.jerseyNumber}</span>}
    </div>
  );
}
