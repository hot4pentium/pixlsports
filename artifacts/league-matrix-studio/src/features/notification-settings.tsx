import { useEffect, useState } from 'react';
import { Bell, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import {
  getGetNotificationConfigQueryKey,
  getGetNotificationPreferencesQueryKey,
  getNotificationSubscriptionStatus,
  useDeleteNotificationSubscription,
  useGetNotificationConfig,
  useGetNotificationPreferences,
  useSaveNotificationSubscription,
  useSendTestNotification,
  useUpdateNotificationPreferences,
} from '@workspace/api-client-react';
import { getBrowserTimeZone, getGameOnTimeZoneOptions } from './game-on-timezone';

function decodeBase64Url(value: string) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getSubscriptionData(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return null;
  return {
    endpoint: json.endpoint,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export function NotificationSettings() {
  const config = useGetNotificationConfig({
    query: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      queryKey: getGetNotificationConfigQueryKey(),
    },
  });
  const save = useSaveNotificationSubscription();
  const remove = useDeleteNotificationSubscription();
  const test = useSendTestNotification();
  const available = Boolean(config.data?.available && config.data.publicKey && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  const preferences = useGetNotificationPreferences({
    query: {
      enabled: available,
      refetchOnWindowFocus: true,
      queryKey: getGetNotificationPreferencesQueryKey(),
    },
  });
  const updatePreferences = useUpdateNotificationPreferences();
  const [enabled, setEnabled] = useState(false);
  const [oneHourBefore, setOneHourBefore] = useState(false);
  const [dayOf, setDayOf] = useState(false);
  const [timezone, setTimezone] = useState(getBrowserTimeZone);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!preferences.data) return;
    setOneHourBefore(preferences.data.oneHourBefore);
    setDayOf(preferences.data.dayOf);
    setTimezone(preferences.data.timezone || getBrowserTimeZone());
  }, [preferences.data]);

  useEffect(() => {
    if (!available) return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!subscription?.endpoint) {
          setEnabled(false);
          return;
        }
        const status = await getNotificationSubscriptionStatus({ endpoint: subscription.endpoint });
        if (status.owned) {
          setEnabled(true);
          const data = getSubscriptionData(subscription);
          if (data) void save.mutateAsync({ data }).catch(() => undefined);
          return;
        }
        // A browser subscription can outlive a Clerk session. Never show it as
        // enabled for a new account; detach it before allowing a new opt-in.
        if (status.ownedByAnotherAccount) {
          await subscription.unsubscribe();
          setMessage('This device was linked to another Pixl Sports account. Alerts were detached; enable them again for this account.');
        }
        setEnabled(false);
      })
      .catch(() => setEnabled(false));
  }, [available]);

  async function enableNotifications() {
    setMessage('');
    if (!available || !config.data?.publicKey) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setMessage(permission === 'denied' ? 'Notifications are blocked. Enable them in your phone settings.' : 'Notification permission was not granted.'); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(config.data.publicKey) });
      const data = getSubscriptionData(subscription);
      if (!data) throw new Error('The browser returned an incomplete push subscription.');
      await save.mutateAsync({ data });
      setEnabled(true); setMessage('Notifications are on for this device.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to enable notifications.'); }
  }

  async function disableNotifications() {
    setMessage('');
    try {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription?.endpoint) { await remove.mutateAsync({ data: { endpoint: subscription.endpoint } }); await subscription.unsubscribe(); }
      setEnabled(false); setMessage('Notifications are off for this device.');
    } catch { setMessage('Unable to turn off notifications. Please try again.'); }
  }

  async function sendTest() {
    setMessage('');
    try { await test.mutateAsync(); setMessage('Test alert sent. Check your phone notification tray.'); }
    catch { setMessage('The test alert could not be sent. Check your notification setup.'); }
  }

  async function updateReminderPreferences(
    next: { oneHourBefore: boolean; dayOf: boolean },
    nextTimezone = timezone,
  ) {
    const previous = { oneHourBefore, dayOf, timezone };
    setOneHourBefore(next.oneHourBefore);
    setDayOf(next.dayOf);
    setTimezone(nextTimezone);
    setMessage('');
    try {
      await updatePreferences.mutateAsync({ data: { ...next, timezone: nextTimezone } });
      setMessage('Event Card alert choices saved.');
    } catch {
      setOneHourBefore(previous.oneHourBefore);
      setDayOf(previous.dayOf);
      setTimezone(previous.timezone);
      setMessage('Unable to save Event Card alert choices. Please try again.');
    }
  }

  const configUnavailable = !config.isLoading && !config.isError && !config.data?.available;
  const scheduledDeliveryEnabled = Boolean(config.data?.available && config.data.scheduledDeliveryEnabled);

  return (
    <section className="space-y-4 border-t border-border/60 pt-6" data-testid="notification-settings">
      <h3 className="flex items-center gap-2 border-b border-border/50 pb-2 text-xs font-bold uppercase tracking-widest text-primary"><Bell className="h-4 w-4" /> Phone Alerts</h3>
       <div className="border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3"><Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="font-bold uppercase tracking-wide">Stay close to game day</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Installing Pixl Sports only adds a shortcut; it does not enable alerts or schedule delivery. To opt in, enable phone alerts and choose at least one Event Card reminder below. The in-app owner dashboard reminder and manual follower announcements are separate.</p></div></div>
        {config.isLoading && <p className="mt-3 text-sm font-medium text-muted-foreground" role="status">Checking phone alert availability…</p>}
         {configUnavailable && <p className="mt-3 text-sm font-medium text-muted-foreground">Phone alerts and scheduled Event Card delivery are not configured on this deployment yet.</p>}
        {config.isError && (
          <div className="mt-3 flex flex-col gap-3 text-sm">
             <p className="font-medium text-destructive">Could not check notification availability or confirm whether scheduled Event Card delivery is active. Do not rely on automatic alerts until the status can be confirmed.</p>
            <button
              type="button"
              onClick={() => void config.refetch()}
              disabled={config.isFetching}
              className="inline-flex min-h-10 w-fit items-center justify-center gap-2 border border-border px-4 py-2.5 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
              data-testid="button-retry-notification-config"
            >
              {config.isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
              {config.isFetching ? 'Checking…' : 'Check Again'}
            </button>
          </div>
        )}
          {available && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={enabled ? disableNotifications : enableNotifications} disabled={save.isPending || remove.isPending} className="inline-flex items-center justify-center gap-2 bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50" data-testid="button-toggle-notifications">{(save.isPending || remove.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{enabled ? 'Turn Off Alerts' : 'Enable Phone Alerts'}</button>{enabled && <button type="button" onClick={sendTest} disabled={test.isPending} className="inline-flex items-center justify-center gap-2 border border-border px-4 py-2.5 text-xs font-bold uppercase tracking-widest disabled:opacity-50" data-testid="button-test-notification">{test.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Send Test Alert</button>}</div>}
         {config.data?.available && !config.isError && (
           <p
             className="mt-3 border-l-2 border-primary/40 bg-background/50 p-3 text-sm leading-relaxed text-muted-foreground"
             role="status"
             aria-live="polite"
             data-testid="status-event-card-delivery"
           >
             {scheduledDeliveryEnabled
               ? 'Scheduled Event Card delivery is active on this deployment. Choose at least one reminder below to opt in; app installation alone does not enable alerts.'
               : 'Scheduled Event Card delivery is not active on this deployment. Your choices can be saved, but automatic alerts will not be sent until the server schedule is enabled.'}
           </p>
         )}
         {available && (
           <div className="mt-5 border-t border-border/60 pt-4" data-testid="notification-preferences">
              <p className="text-xs font-bold uppercase tracking-widest text-foreground">Event Card reminders</p>
               <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Select one or both to opt in. Turn both off to stop scheduled Event Card alerts for your account; this does not send or control follower announcements. The one-hour alert follows the event’s saved time zone; the day-of alert is scheduled for 7:00 a.m. in your alert time zone.</p>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-semibold">Alert time zone</span>
                <select
                  value={timezone}
                  onChange={(event) => void updateReminderPreferences({ oneHourBefore, dayOf }, event.target.value)}
                  disabled={preferences.isLoading || updatePreferences.isPending}
                  className="min-h-10 w-full border border-border bg-background px-3 py-2 text-sm sm:max-w-sm"
                  data-testid="select-notification-timezone"
                >
                  {getGameOnTimeZoneOptions(timezone).map((option) => (
                    <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>
                  ))}
                </select>
              </label>
             <div className="mt-3 space-y-2">
               <label className="flex items-start gap-3 text-sm">
                 <input
                   type="checkbox"
                   checked={oneHourBefore}
                   onChange={(event) => void updateReminderPreferences({ oneHourBefore: event.target.checked, dayOf })}
                   disabled={preferences.isLoading || updatePreferences.isPending}
                   className="mt-0.5 h-4 w-4 accent-primary"
                   data-testid="checkbox-reminder-one-hour"
                 />
                   <span><span className="font-semibold">One hour before</span><span className="block text-xs text-muted-foreground">Get one reminder before each upcoming timed Event Card, even if you have already published your Hype Card.</span></span>
               </label>
               <label className="flex items-start gap-3 text-sm">
                 <input
                   type="checkbox"
                   checked={dayOf}
                   onChange={(event) => void updateReminderPreferences({ oneHourBefore, dayOf: event.target.checked })}
                   disabled={preferences.isLoading || updatePreferences.isPending}
                   className="mt-0.5 h-4 w-4 accent-primary"
                   data-testid="checkbox-reminder-day-of"
                 />
                  <span><span className="font-semibold">Day of the event</span><span className="block text-xs text-muted-foreground">Get one alert at 7:00 a.m. in your selected alert time zone.</span></span>
               </label>
             </div>
           </div>
         )}
        {enabled && <p className="mt-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><ShieldCheck className="h-4 w-4" /> This device is connected</p>}
        {message && <p className="mt-3 text-sm font-medium text-muted-foreground" role="status">{message}</p>}
      </div>
    </section>
  );
}