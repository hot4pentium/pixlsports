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
    design: a.design, lowerThirdTemplate: a.lowerThirdTemplate,
    borderColor: a.borderColor, accentColor: a.accentColor,
    athleteX: a.athleteX, athleteY: a.athleteY, athleteScale: a.athleteScale,
  }, `lc${uid}`), [athleteName, teamName, a.jerseyNumber, a.position, a.design, a.lowerThirdTemplate, a.borderColor, a.accentColor, a.athleteX, a.athleteY, a.athleteScale, usablePhoto, style, uid]);
  return (
    <div className="living-card-face living-card-simple-face" key="front" data-design={a.design}>
      <div className="living-card-simple-art" role="img" aria-label={photoAlt ?? `${athleteName} HYPE Card`} data-testid="img-living-card-athlete" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="sr-only" data-testid="text-living-card-athlete-name">{athleteName}</span>
      {teamName && <span className="sr-only" data-testid="text-living-card-team-name">{teamName}</span>}
        {a.position && <span className="sr-only" data-testid="text-living-card-position">Position {a.position}</span>}
      {a.jerseyNumber && <span className="sr-only" data-testid="text-living-card-jersey-number">Number {a.jerseyNumber}</span>}
    </div>
  );
}

export type NativeHypeCardFrontProps = {
  athleteName: string;
  teamName?: string | null;
  seasonName?: string | null;
  photoUrl?: string | null;
  appearance?: Partial<HypeCardAppearance> | null;
  onPhotoError?: () => void;
};

/** Full-bleed photo front matching ios/PIXL Sports/NativeHypeCardFront.swift. */
export function NativeHypeCardFront({ athleteName, teamName, seasonName, photoUrl, appearance, onPhotoError }: NativeHypeCardFrontProps) {
  const a = useMemo(() => normalizeCardAppearance(appearance ?? {}), [appearance]);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const usablePhoto = photoUrl && photoUrl !== failedPhoto ? photoUrl : null;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  // Preserve the owner's saved photo placement while always covering the whole face.
  const photoX = clamp(50 - a.athleteX * 200);
  const photoY = clamp(50 - a.athleteY * 200);
  const photoScale = Math.max(1, a.athleteScale);
  const identity = [a.jerseyNumber ? `#${a.jerseyNumber.replace(/^#/, '')}` : '', a.position].filter(Boolean).join(' · ');
  const teamLine = [teamName ?? '', seasonName ?? ''].filter((part) => part.trim()).join(' · ');
  return (
    <div className="lc-native-front" data-testid="img-living-card-athlete" role="img" aria-label={`${athleteName}${teamName ? `, ${teamName}` : ''}${seasonName ? `, ${seasonName}` : ''}, HYPE Card`}>
      {usablePhoto ? (
        <img
          className="lc-native-front-photo"
          src={usablePhoto}
          alt=""
          style={{ objectPosition: `${photoX}% ${photoY}%`, transform: `scale(${photoScale})`, transformOrigin: `${photoX}% ${photoY}%` }}
          onError={() => { setFailedPhoto(usablePhoto); onPhotoError?.(); }}
        />
      ) : (
        <svg className="lc-native-front-silhouette" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="4.5" /><path d="M3 22c0-5 4-8.5 9-8.5s9 3.5 9 8.5z" /></svg>
      )}
      <div className="lc-native-front-shade" aria-hidden="true" />
      <div className="lc-native-front-identity" aria-hidden="true">
        <span className="lc-native-front-eyebrow">PIXL SPORTS · HYPE CARD</span>
        <strong className="lc-native-front-name">{athleteName}</strong>
        {teamLine && <span className="lc-native-front-team">{teamLine}</span>}
        {identity && <span className="lc-native-front-details">{identity}</span>}
      </div>
      <span className="sr-only" data-testid="text-living-card-athlete-name">{athleteName}</span>
      {teamName && <span className="sr-only" data-testid="text-living-card-team-name">{teamName}</span>}
      {a.position && <span className="sr-only" data-testid="text-living-card-position">Position {a.position}</span>}
      {a.jerseyNumber && <span className="sr-only" data-testid="text-living-card-jersey-number">Number {a.jerseyNumber}</span>}
    </div>
  );
}
