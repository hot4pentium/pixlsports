import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { isIosDevice } from './schedule-install';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function FanCardInstall({ inviteToken }: { inviteToken: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [notice, setNotice] = useState('');
  const isIOS = isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

  useEffect(() => {
    if (!inviteToken) return;
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifest) return;
    const originalHref = `${import.meta.env.BASE_URL}manifest.webmanifest`;
    manifest.href = `/api/athlete-invites/${encodeURIComponent(inviteToken)}/manifest.webmanifest?basePath=${encodeURIComponent(import.meta.env.BASE_URL)}`;
    return () => { manifest.href = originalHref; };
  }, [inviteToken]);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setInstalled(standalone);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); setNotice('The Hype Card is on your home screen.'); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) {
      setShowInstructions((value) => !value);
      return;
    }
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      if (choice.outcome === 'dismissed') setShowInstructions(true);
    } catch {
      setShowInstructions(true);
      setNotice('Use your browser menu to add this card to your home screen.');
    }
  }

  return (
    <section className="border border-white/15 bg-white/[.04] p-4" aria-label="Keep this Hype Card" data-testid="fan-card-install">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-display text-xl uppercase">Keep this card close</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/60">Save this athlete’s link to your phone. The card stays current as the season grows.</p>
        </div>
      </div>
      {!installed ? (
        <button type="button" onClick={() => void install()} className="mt-4 inline-flex min-h-11 items-center gap-2 border border-primary px-4 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground" aria-expanded={showInstructions} data-testid="button-install-fan-card">
          <Download className="h-4 w-4" aria-hidden="true" /> {prompt ? 'Add to home screen' : 'How to add to home screen'}
        </button>
      ) : (
        <p className="mt-4 text-xs font-bold uppercase tracking-widest text-primary" role="status">Opened from your home screen</p>
      )}
      {showInstructions && !installed && (
        <p className="mt-3 text-sm leading-relaxed text-white/70" data-testid="fan-card-install-instructions">
          {isIOS
            ? 'In Safari on iPhone or iPad, tap Share, choose Add to Home Screen, then tap Add. To receive web push alerts on iPhone, open the saved card from your home screen.'
            : 'In your browser menu, choose Install app or Add to Home Screen. If your browser does not offer that option, bookmark this card’s link instead.'}
        </p>
      )}
      {notice && <p className="mt-3 text-xs text-white/70" role="status">{notice}</p>}
    </section>
  );
}