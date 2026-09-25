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

function FanCardFollow({ inviteToken }: { inviteToken: string }) {
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
    import.meta.env.PROD && window.isSecureContext && config.data?.available && config.data?.publicKey
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    && (!isIOS || standalone),
  );
  const activeAlerts = Boolean(followToken && status.data?.active && supported && permission === 'granted');
  const liveAlerts = activeAlerts && Boolean(status.data?.liveAlerts);
  const eventAlerts = activeAlerts && Boolean(status.data?.eventAlerts);

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
      setMessage('Following on this device. Choose which alerts you want below.');
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

  async function toggleAlert(kind: 'live' | 'event') {
    if (!following || pending) return;
    setPending(true);
    setMessage('');
    const next = {
      liveAlerts: kind === 'live' ? !liveAlerts : liveAlerts,
      eventAlerts: kind === 'event' ? !eventAlerts : eventAlerts,
    };
    try {
      if (!next.liveAlerts && !next.eventAlerts) {
        if (followToken) await remove.mutateAsync({ inviteToken });
        saveLocal(true, '');
        setMessage('Alerts are off. You are still following this card on this device.');
        return;
      }
      if (!supported || !config.data?.publicKey) {
        setMessage('Alerts are not available in this browser. You can still keep this card on your home screen.');
        return;
      }
      if (!followToken) {
        const nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
        if (nextPermission !== 'granted') {
          setMessage(nextPermission === 'denied'
            ? 'Your browser has blocked alerts. Change its notification setting to enable them.'
            : 'Notification permission was not granted. No alerts were enabled.');
          return;
        }
        const registration = await navigator.serviceWorker.ready;
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
            ...next,
          },
        });
        saveLocal(true, created.followToken);
      } else {
        await update.mutateAsync({ inviteToken, data: next });
        await status.refetch();
      }
      setMessage('Your alert choices were saved for this device.');
    } catch (error) {
      setMessage(error instanceof Error ? `Alerts could not be saved: ${error.message}` : 'Alerts could not be saved. Please try again.');
    } finally {
      setPending(false);
    }
  }

  const availability = !import.meta.env.PROD
    ? 'Push alerts are available on the published site. You can follow and save the card here.'
    : isIOS && !standalone
      ? 'On iPhone, first add this card to your home screen and open it there to enable alerts.'
      : permission === 'denied'
        ? 'Alerts are blocked in this browser’s notification settings.'
        : config.isError
          ? 'Could not check alert availability right now.'
          : !config.isLoading && !supported
            ? 'This browser or deployment does not support push alerts. You can still save this card.'
            : '';

  return (
    <section className="border border-[#8ecbff]/30 bg-[#102b4d] p-5 text-white" aria-label="Follow this athlete" data-testid="fan-card-follow">
      <div className="flex items-start gap-3">
        {following ? <Bell className="mt-0.5 h-5 w-5 text-[#ff7849]" aria-hidden="true" /> : <BellOff className="mt-0.5 h-5 w-5 text-[#8ecbff]" aria-hidden="true" />}
        <div>
          <h2 className="font-display text-2xl uppercase">Follow this card</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/65">Keep this athlete’s season close. Alerts are optional and only sent to this device when you choose them.</p>
        </div>
      </div>
      <button type="button" onClick={() => void toggleFollow()} disabled={pending} className="mt-4 min-h-11 border border-[#ff7849] bg-[#ff7849] px-5 text-xs font-extrabold uppercase tracking-widest text-[#102b4d] disabled:opacity-50" aria-pressed={following} data-testid="button-follow-fan-card">
        {following ? 'Unfollow this card' : 'Follow on this device'}
      </button>
      {following && (
        <div className="mt-5 space-y-3 border-t border-white/15 pt-4" role="group" aria-label="Optional phone alerts">
          {(['live', 'event'] as const).map((kind) => (
            <label key={kind} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
              <span>{kind === 'live' ? 'Game Day Live starts' : 'A scheduled event begins'}</span>
              <input type="checkbox" checked={kind === 'live' ? liveAlerts : eventAlerts} onChange={() => void toggleAlert(kind)} disabled={pending || !supported || permission === 'denied' || status.isLoading} className="h-5 w-5 accent-[#ff7849] disabled:opacity-40" data-testid={`input-fan-alert-${kind}`} />
            </label>
          ))}
          <p className="text-xs leading-relaxed text-white/55">You can change either choice or unfollow here at any time. No account is needed.</p>
        </div>
      )}
      {availability && <p className="mt-3 text-xs leading-relaxed text-white/65" data-testid="status-fan-alert-availability">{availability}</p>}
      {message && <p role="status" className="mt-3 text-xs leading-relaxed text-[#ffae8f]" data-testid="status-fan-follow">{message}</p>}
    </section>
  );
}