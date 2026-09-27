import './living-athlete-card.css';

export type LivingAthleteCardFrontProps = {
  athleteName: string;
  teamName?: string | null;
  photoUrl?: string | null;
  onPhotoError?: () => void;
};

export function LivingAthleteCardFront({
  athleteName,
  teamName,
  photoUrl,
  onPhotoError,
}: LivingAthleteCardFrontProps) {
  return (
    <div className="living-card-face" key="front">
      {photoUrl ? (
        <img className="living-card-photo" src={photoUrl} alt={`Portrait of ${athleteName}`} onError={onPhotoError} data-testid="img-living-card-athlete" />
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