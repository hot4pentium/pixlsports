import { useEffect, useId, useState } from 'react';
import { QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import './hype-card-share-qr.css';

/** Encodes the same public card link used by Share and Copy link, locally. */
export function HypeCardShareQr({ url, athleteName }: { url: string; athleteName: string }) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ url: string; image?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setResult(null);
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' },
    }).then((image) => {
      if (active) setResult({ url, image });
    }).catch(() => {
      if (active) setResult({ url, error: 'The QR code couldn’t be created. You can still share or copy the link.' });
    });
    return () => { active = false; };
  }, [url, expanded, attempt]);

  const current = result?.url === url ? result : null;
  return (
    <div className="hype-share-qr">
      <button type="button" className="hype-share-qr__toggle"
        aria-expanded={expanded} aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)} data-testid="button-show-hype-card-qr">
        <QrCode aria-hidden="true" />{expanded ? 'Hide QR code' : 'Show QR code'}
      </button>
      {expanded && (
        <div id={panelId} className="hype-share-qr__panel" data-testid="panel-hype-card-qr">
          {current?.image ? (
            <>
              <img src={current.image} width={320} height={320}
                alt={`QR code for ${athleteName}'s HYPE Card`} data-testid="img-hype-card-share-qr" />
              <p>Scan to open {athleteName}’s HYPE Card.</p>
            </>
          ) : current?.error ? (
            <>
              <p role="alert">{current.error}</p>
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
            </>
          ) : <p role="status">Preparing QR code…</p>}
        </div>
      )}
    </div>
  );
}
