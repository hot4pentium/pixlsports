import { useEffect, useId, useRef, useState } from 'react';

/** Local capture only: choosing a clip never publishes it or changes the HYPE Card. */
export function EventCardRecordMoments({ active = true }: { active?: boolean }) {
  const inputId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [clip, setClip] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!clip) return;
    const next = URL.createObjectURL(clip);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [clip]);
  useEffect(() => { if (!active) videoRef.current?.pause(); }, [active]);
  return (
    <section className="game-on-collection__share-option" aria-labelledby={`${inputId}-title`}>
      <h4 id={`${inputId}-title`}>Record Moments</h4>
      <p>Available anytime. Record or choose a video, then save it on your device. Nothing is uploaded or published.</p>
      <label htmlFor={inputId}>Record or choose a video</label>
      <input id={inputId} type="file" accept="video/*" capture="environment"
        data-testid="input-event-record-moments"
        style={{ width: '100%', minWidth: 0 }}
        onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setClip(file); }} />
      {url && clip && (
        <>
          <video ref={videoRef} src={url} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 300 }} />
          <a href={url} download={clip.name}>Save video to device</a>
          <p role="status">Keep your video before closing this Event Card.</p>
        </>
      )}
    </section>
  );
}
