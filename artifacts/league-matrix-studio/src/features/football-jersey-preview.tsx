import { useState, type CSSProperties } from 'react';
import { getGetSportGearArtUrl } from '@workspace/api-client-react';
import './football-jersey-preview.css';

const photo = getGetSportGearArtUrl('football-jersey-base.webp');
const mask = getGetSportGearArtUrl('football-jersey-mask.webp');

export function FootballJerseyPreview({ name, number, label, accent = '#2878f5' }: {
  name: string; number: string; label: string; accent?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="football-jersey-preview" role="img" aria-label={label} data-testid="image-showcase-football-jersey"
      style={{ '--football-jersey-accent': accent, '--football-jersey-mask': `url("${mask}")` } as CSSProperties}>
      {failed ? <p role="alert">Jersey artwork couldn’t load. Refresh to try again.</p> : (
        <div className="football-jersey-preview__photo">
          <img src={photo} alt="" aria-hidden="true" onError={() => setFailed(true)} data-testid="photo-football-jersey" />
          <span className="football-jersey-preview__dye" aria-hidden="true" />
          <span className="football-jersey-preview__name" aria-hidden="true">{name.toUpperCase().slice(0, 14)}</span>
          <span className="football-jersey-preview__number" aria-hidden="true">{number || '—'}</span>
        </div>
      )}
    </div>
  );
}
