import { useEffect, useState } from 'react';
import {
  getScheduleInstallAction,
  isIosDevice,
  isStandaloneInstallMode,
  type ScheduleInstallAction,
} from './schedule-install';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function detectStandaloneMode() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const displayModeStandalone = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return isStandaloneInstallMode(displayModeStandalone, navigatorStandalone);
}

function detectIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

export function useAppInstallPrompt(): {
  action: ScheduleInstallAction;
  isIOS: boolean;
  isStandalone: boolean;
  showInstructions: boolean;
  handleInstall: () => Promise<void>;
} {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(detectIosDevice);
  const [isStandalone, setIsStandalone] = useState(detectStandaloneMode);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
    const syncStandaloneState = () => {
      const standalone = isStandaloneInstallMode(
        standaloneQuery?.matches ?? false,
        (navigator as Navigator & { standalone?: boolean }).standalone,
      );
      setIsStandalone(standalone);
      if (standalone) {
        setDeferredPrompt(null);
        setShowInstructions(false);
      }
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      if (detectStandaloneMode()) {
        syncStandaloneState();
        return;
      }
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setShowInstructions(false);
    };

    syncStandaloneState();
    setIsIOS(detectIosDevice());
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    standaloneQuery?.addEventListener('change', syncStandaloneState);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      standaloneQuery?.removeEventListener('change', syncStandaloneState);
    };
  }, []);

  const action = getScheduleInstallAction({
    isStandalone,
    canPrompt: Boolean(deferredPrompt),
  });

  const handleInstall = async () => {
    if (action !== 'install' || !deferredPrompt) {
      if (action !== 'installed') {
        setShowInstructions((current) => !current);
      }
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsStandalone(true);
        setShowInstructions(false);
      }
    } catch {
      setShowInstructions(true);
    } finally {
      setDeferredPrompt(null);
    }
  };

  return { action, isIOS, isStandalone, showInstructions, handleInstall };
}