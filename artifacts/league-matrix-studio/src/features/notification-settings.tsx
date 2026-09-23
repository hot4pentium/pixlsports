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
  const [oneHourBefore, setOneHourBefore] = useState(true);
  const [dayOf, setDayOf] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!preferences.data) return;
    setOneHourBefore(preferences.data.oneHourBefore);
    setDayOf(preferences.data.dayOf);
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

  async function updateReminderPreferences(next: { oneHourBefore: boolean; dayOf: boolean }) {
    const previous = { oneHourBefore, dayOf };
    setOneHourBefore(next.oneHourBefore);
    setDayOf(next.dayOf);
    setMessage('');
    try {
      await updatePreferences.mutateAsync({ data: next });
      setMessage('Reminder preferences saved.');
    } catch {
      setOneHourBefore(previous.oneHourBefore);
      setDayOf(previous.dayOf);
      setMessage('Unable to save reminder preferences. Please try again.');
    }
  }

  const configUnavailable = !config.isLoading && !config.isError && !config.data?.available;

  return (
    <section className="space-y-4 border-t border-border/60 pt-6" data-testid="notification-settings">
      <h3 className="flex items-center gap-2 border-b border-border/50 pb-2 text-xs font-bold uppercase tracking-widest text-primary"><Bell className="h-4 w-4" /> Phone Alerts</h3>
      <div className="border border-primary/20 bg-primary/5 p-4">
         <div className="flex items-start gap-3"><Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="font-bold uppercase tracking-wide">Stay close to the week</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Choose when Pixl Sports reminds you about games, practices, and meetings—even when the app is closed. Alerts follow the time zone saved for this device.</p></div></div>
        {config.isLoading && <p className="mt-3 text-sm font-medium text-muted-foreground" role="status">Checking phone alert availability…</p>}
        {configUnavailable && <p className="mt-3 text-sm font-medium text-muted-foreground">Phone alerts are not configured on this deployment yet.</p>}
        {config.isError && (
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p className="font-medium text-destructive">Could not check notification availability.</p>
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
         {available && (
           <div className="mt-5 border-t border-border/60 pt-4" data-testid="notification-preferences">
             <p className="text-xs font-bold uppercase tracking-widest text-foreground">Schedule reminders</p>
             <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The one-hour reminder opens the Capture window for games. The day-of reminder arrives at 7:00 AM.</p>
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
                 <span><span className="font-semibold">One hour before</span><span className="block text-xs text-muted-foreground">Get the prompt to capture the moment.</span></span>
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
                 <span><span className="font-semibold">Day of the event</span><span className="block text-xs text-muted-foreground">Get a planning reminder at 7:00 AM.</span></span>
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