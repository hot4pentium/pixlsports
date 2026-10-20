import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import {
  getGetAthleteInviteFanFollowQueryKey,
  getGetNotificationConfigQueryKey,
  useCreateAthleteInviteFanFollow,
  useDeleteAthleteInviteFanFollow,
  useGetAthleteInviteFanFollow,
  useGetNotificationConfig,
  useUpdateAthleteInviteFanFollow,
} from '@workspace/api-client-react';
import { isIosDevice } from './schedule-install';
import { FanCardInstall } from './fan-card-install';
import { nextFanAlertPreferences, type FanAlertChoice } from './fan-card-alerts';
import { fanPushRegistration } from './fan-push-registration';

function decodePublicKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0));
  return new Uint8Array(bytes);
}

function storedFollow(token: string): { following: boolean; followToken: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(`pixl-fan-card-follow:${token}`) || '{}') as Record<string, unknown>;
    return {
      following: saved.following === true,
      followToken: typeof saved.followToken === 'string' ? saved.followToken : '',
    };
  } catch {
    return { following: false, followToken: '' };
  }
}

export function FanCardActions({ inviteToken }: { inviteToken: string }) {
  return (
    <div className="space-y-4">
      <FanCardFollow inviteToken={inviteToken} />
      <FanCardInstall inviteToken={inviteToken} />
    </div>
  );
}

export function FanCardFollow({
  inviteToken,
  surface = 'card',
}: {
  inviteToken: string;
  surface?: 'card' | 'showcase';
}) {
  const [following, setFollowing] = useState(() => storedFollow(inviteToken).following);
  const [followToken, setFollowToken] = useState(() => storedFollow(inviteToken).followToken);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [permission, setPermission] = useState(() => 'Notification' in window ? Notification.permission : 'default');
  const config = useGetNotificationConfig({ query: { queryKey: getGetNotificationConfigQueryKey(), retry: false } });
  const headers = { 'X-Fan-Follow-Token': followToken };
  const status = useGetAthleteInviteFanFollow(inviteToken, {
    query: {
      enabled: Boolean(inviteToken && followToken),
      queryKey: [...getGetAthleteInviteFanFollowQueryKey(inviteToken), followToken],
      retry: false,
      refetchOnWindowFocus: true,
    },
    request: { headers },
  });
  const create = useCreateAthleteInviteFanFollow();
  const update = useUpdateAthleteInviteFanFollow({ request: { headers } });
  const remove = useDeleteAthleteInviteFanFollow({ request: { headers } });
  const isIOS = isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const supported = Boolean(
    window.isSecureContext && config.data?.available && config.data?.publicKey
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    && (!isIOS || standalone),
  );
  const liveAlerts = Boolean(followToken && status.data?.liveAlerts);
  const preEventAlerts = Boolean(followToken && status.data?.preEventAlerts);

  useEffect(() => {
    const saved = storedFollow(inviteToken);
    setFollowing(saved.following);
    setFollowToken(saved.followToken);
    setMessage('');
  }, [inviteToken]);

  useEffect(() => {
    if (!followToken || !status.isError) return;
    const error = status.error as { status?: number; response?: { status?: number } } | null;
    if (error?.status !== 404 && error?.response?.status !== 404) {
      setMessage('Could not verify your alert settings. Alerts may still be active; try again before changing them.');
      return;
    }
    // Only a confirmed 404 means the server no longer holds this subscription.
    setFollowToken('');
    localStorage.setItem(`pixl-fan-card-follow:${inviteToken}`, JSON.stringify({ following, followToken: '' }));
    setMessage('Alerts for this device are no longer active. You can turn them on again.');
  }, [followToken, status.isError, status.error, inviteToken, following]);

  function saveLocal(nextFollowing: boolean, nextToken: string) {
    setFollowing(nextFollowing);
    setFollowToken(nextToken);
    if (nextFollowing) localStorage.setItem(`pixl-fan-card-follow:${inviteToken}`, JSON.stringify({ following: true, followToken: nextToken }));
    else localStorage.removeItem(`pixl-fan-card-follow:${inviteToken}`);
  }

  async function toggleFollow() {
    setMessage('');
    if (!following) {
      saveLocal(true, '');
      setMessage('Following on this device. Choose which phone alerts to receive below.');
      return;
    }
    setPending(true);
    try {
      if (followToken) await remove.mutateAsync({ inviteToken });
      saveLocal(false, '');
      setMessage('Unfollowed. This device will no longer receive this athlete’s alerts.');
    } catch {
      setMessage('Could not turn off alerts. Please try again before unfollowing.');
    } finally {
      setPending(false);
    }
  }

  async function toggleAlert(kind: FanAlertChoice) {
    if (!following || pending || (followToken && (status.isError || !status.data))) return;
    setPending(true);
    setMessage('');
    const enabling = kind === 'live' ? !liveAlerts : !preEventAlerts;
    const next = nextFanAlertPreferences({ liveAlerts, preEventAlerts }, kind);
    const legacyEventAlerts = Boolean(status.data?.eventAlerts);
    try {
      if (!next.liveAlerts && !next.preEventAlerts && !legacyEventAlerts) {
        if (followToken) await remove.mutateAsync({ inviteToken });
        saveLocal(true, '');
        setMessage('Alerts are off. You are still following this card on this device.');
        return;
      }
      if (enabling && (!supported || !config.data?.publicKey)) {
        setMessage(availability || 'Alerts are not available in this browser right now. Please try again.');
        return;
      }
      if (enabling && permission !== 'granted') {
        const nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
        if (nextPermission !== 'granted') {
          setMessage(nextPermission === 'denied'
            ? 'Your browser has blocked alerts. Change its notification setting to enable them.'
            : 'Notification permission was not granted. No alerts were enabled.');
          return;
        }
      }
      if (!followToken) {
        if (!config.data?.publicKey) throw new Error('Push alerts are not configured on this server.');
        const registration = await fanPushRegistration();
        const subscription = await registration.pushManager.getSubscription()
          ?? await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: decodePublicKey(config.data.publicKey),
          });
        const data = subscription.toJSON();
        if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) {
          throw new Error('This browser did not provide a complete push subscription.');
        }
        const created = await create.mutateAsync({
          inviteToken,
          data: {
            endpoint: data.endpoint,
            keys: { p256dh: data.keys.p256dh, auth: data.keys.auth },
            liveAlerts: next.liveAlerts,
            eventAlerts: false,
            preEventAlerts: next.preEventAlerts,
          },
        });
        saveLocal(true, created.followToken);
      } else {
        await update.mutateAsync({
          inviteToken,
          data: { liveAlerts: next.liveAlerts, eventAlerts: legacyEventAlerts, preEventAlerts: next.preEventAlerts },
        });
        await status.refetch();
      }
      setMessage('Your alert choices were saved for this device.');
    } catch (error) {
      setMessage(error instanceof Error ? `Alerts could not be saved: ${error.message}` : 'Alerts could not be saved. Please try again.');
    } finally {
      setPending(false);
    }
  }

  const availability = isIOS && !standalone
      ? 'On iPhone, first add this card to your home screen and open it there to enable alerts.'
      : permission === 'denied'
        ? 'Alerts are blocked in this browser’s notification settings.'
        : config.isError
          ? 'Could not check alert availability right now.'
          : !config.isLoading && !supported
            ? 'This browser or deployment does not support push alerts. You can still save this card.'
            : '';

  return (
    <section className="border border-[#8ecbff]/30 bg-[#102b4d] p-5 text-white" aria-label={surface === 'showcase' ? 'Event alerts' : 'Follow this athlete'} data-testid="fan-card-follow">
      <div className="flex items-start gap-3">
        {following ? <Bell className="mt-0.5 h-5 w-5 text-[#ff7849]" aria-hidden="true" /> : <BellOff className="mt-0.5 h-5 w-5 text-[#8ecbff]" aria-hidden="true" />}
        <div>
          <h2 className="font-display text-2xl uppercase">{surface === 'showcase' ? 'Get event alerts' : 'Follow this card'}</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/65">
            {surface === 'showcase'
              ? 'Follow this athlete on your device, then choose which event-day alerts you want. No account is needed.'
              : 'Keep this athlete’s season close. Alerts are optional and only sent to this device when you choose them.'}
          </p>
        </div>
      </div>
      <button type="button" onClick={() => void toggleFollow()} disabled={pending} className="mt-4 min-h-11 border border-[#ff7849] bg-[#ff7849] px-5 text-xs font-extrabold uppercase tracking-widest text-[#102b4d] disabled:opacity-50" aria-pressed={following} data-testid="button-follow-fan-card">
        {following ? 'Unfollow this card' : surface === 'showcase' ? 'Subscribe on this device' : 'Follow on this device'}
      </button>
      {availability && <p className="mt-4 border-l-2 border-[#ff7849] pl-3 text-sm leading-relaxed text-white/80" data-testid="status-fan-alert-availability">{availability}</p>}
      {config.isError && <button type="button" onClick={() => void config.refetch()} className="mt-2 min-h-11 underline" data-testid="button-retry-fan-alert-config">Check alert availability again</button>}
      <div className="mt-5 space-y-3 border-t border-white/15 pt-4" role="group" aria-label="Optional phone alerts">
          {!following && <p className="text-xs leading-relaxed text-white/65">Follow this card to choose your phone alerts. Both choices start off.</p>}
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
            <span>Game Day Live starts</span>
            <input type="checkbox" checked={liveAlerts} onChange={() => void toggleAlert('live')} disabled={!following || pending || config.isLoading || Boolean(followToken && (status.isLoading || status.isError || !status.data))} className="h-6 w-6 shrink-0 cursor-pointer accent-[#ff7849] disabled:cursor-not-allowed disabled:opacity-40" data-testid="input-fan-alert-live" />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
            <span>Pre-event Hype Card announcements</span>
            <input type="checkbox" checked={preEventAlerts} onChange={() => void toggleAlert('event')} disabled={!following || pending || config.isLoading || Boolean(followToken && (status.isLoading || status.isError || !status.data))} className="h-6 w-6 shrink-0 cursor-pointer accent-[#ff7849] disabled:cursor-not-allowed disabled:opacity-40" data-testid="input-fan-alert-event" />
          </label>
          <p className="text-xs leading-relaxed text-white/55">The card owner chooses whether to send a pre-event announcement. Following or enabling Game Day Live does not turn these on. Change either choice or unfollow here at any time; no account is needed.</p>
      </div>
      {message && <p role="status" className="mt-3 text-xs leading-relaxed text-[#ffae8f]" data-testid="status-fan-follow">{message}</p>}
    </section>
  );
}