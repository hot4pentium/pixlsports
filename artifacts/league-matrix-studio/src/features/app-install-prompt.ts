import { useEffect, useRef, useState } from 'react';
import {
  getScheduleInstallAction,
  isIosDevice,
  isStandaloneInstallMode,
  type ScheduleInstallAction,
} from './schedule-install';
import { trackEvent } from '../lib/analytics';

type InstallDeviceClass = 'mobile' | 'desktop';
type InstallMethod = 'native_prompt' | 'fallback_instructions' | 'unknown';
type InstallSurface = 'dashboard' | 'shared_schedule' | 'landing';

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

export function useAppInstallPrompt(surface: InstallSurface = 'dashboard'): {
  action: ScheduleInstallAction;
  isIOS: boolean;
  isStandalone: boolean;
  showInstructions: boolean;
  handleInstall: (deviceClass: InstallDeviceClass) => Promise<void>;
  dismissInstructions: () => void;
} {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(detectIosDevice);
  const [isStandalone, setIsStandalone] = useState(detectStandaloneMode);
  const [showInstructions, setShowInstructions] = useState(false);
  const lastInstallMethod = useRef<InstallMethod>('unknown');
  const lastDeviceClass = useRef<InstallDeviceClass | 'unknown'>('unknown');

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
      trackEvent('app_install_confirmed', {
        device_class: lastDeviceClass.current,
        prompt_type: lastInstallMethod.current,
        surface,
      });
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

  const handleInstall = async (deviceClass: InstallDeviceClass) => {
    if (action !== 'install' || !deferredPrompt) {
      if (action !== 'installed') {
        if (showInstructions) {
          setShowInstructions(false);
          return;
        }
        lastInstallMethod.current = 'fallback_instructions';
        lastDeviceClass.current = deviceClass;
        trackEvent('app_install_instructions_viewed', {
          device_class: deviceClass,
          prompt_type: isIOS ? 'ios_instructions' : 'browser_instructions',
          entry_point: 'fallback',
          surface,
        });
        setShowInstructions(true);
      }
      return;
    }

    lastInstallMethod.current = 'native_prompt';
    lastDeviceClass.current = deviceClass;
    trackEvent('app_install_prompt_shown', {
      device_class: deviceClass,
      prompt_type: 'native_prompt',
      surface,
    });

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      trackEvent('app_install_prompt_outcome', {
        device_class: deviceClass,
        prompt_type: 'native_prompt',
        outcome: choice.outcome,
        surface,
      });
      if (choice.outcome === 'accepted') {
        setIsStandalone(true);
        setShowInstructions(false);
      }
    } catch {
      lastInstallMethod.current = 'fallback_instructions';
      trackEvent('app_install_instructions_viewed', {
        device_class: deviceClass,
        prompt_type: isIOS ? 'ios_instructions' : 'browser_instructions',
        entry_point: 'prompt_recovery',
        surface,
      });
      setShowInstructions(true);
    } finally {
      setDeferredPrompt(null);
    }
  };

  const dismissInstructions = () => setShowInstructions(false);

  return { action, isIOS, isStandalone, showInstructions, handleInstall, dismissInstructions };
}