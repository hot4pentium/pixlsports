import { useEffect, useRef, useState } from 'react';

/** A face can remain mounted behind the card during a flip. Never leave it audible. */
export function LivingCardVideo({ src, poster, token, active }: {
  src: string;
  poster?: string | null;
  token: string;
  active: boolean;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const video = player.current;
    if (!active) video?.pause();
    return () => { video?.pause(); };
  }, [active, src, attempt]);
  return (
    <div>
      <video
        key={`${src}:${attempt}`}
        ref={player}
        src={src}
        poster={poster ?? undefined}
        controls
        autoPlay={active}
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        data-testid={`video-living-card-${token}`}
        aria-label="Shared athlete video"
      />
      {failed && (
        <div role="alert">
          <p>This video could not be loaded. Please try again.</p>
          <button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>
            Retry video
          </button>
        </div>
      )}
    </div>
  );
}
