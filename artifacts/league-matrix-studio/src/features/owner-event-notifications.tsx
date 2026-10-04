import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarDays } from 'lucide-react';
import {
  getAthleteInviteEventNotificationProgress,
  getGetAthleteInviteEventNotificationProgressQueryKey,
  useGetAthleteInviteEventNotificationProgress,
  useNotifyAthleteInviteEventFollowers,
  type OwnedAthleteInvite,
} from '@workspace/api-client-react';

export function OwnerEventNotifications({
  invite,
}: {
  invite: Pick<OwnedAthleteInvite, 'inviteToken' | 'showEvents' | 'events'>;
}) {
  const token = invite.inviteToken;
  const queryClient = useQueryClient();
  const notify = useNotifyAthleteInviteEventFollowers();
  const requestedToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('shareToken')
    : null;
  const [selectedToken, setSelectedToken] = useState(requestedToken ?? '');
  const [notifyFeedback, setNotifyFeedback] = useState('');
  const [notifyError, setNotifyError] = useState(false);
  const [sendingToken, setSendingToken] = useState('');
  const scrolledFor = useRef('');
  const upcoming = invite.showEvents
    ? invite.events.filter((event) => event.type === 'game' && event.status === 'upcoming')
    : [];
  const validSelection = upcoming.some((event) => event.shareToken === selectedToken)
    ? selectedToken
    : (upcoming.find((event) => event.shareToken === requestedToken)?.shareToken ?? upcoming[0]?.shareToken ?? '');
  const selected = upcoming.find((event) => event.shareToken === validSelection);
  const progress = useGetAthleteInviteEventNotificationProgress(token, validSelection, {
    query: {
      queryKey: getGetAthleteInviteEventNotificationProgressQueryKey(token, validSelection),
      enabled: Boolean(token && invite.showEvents && validSelection),
      refetchOnWindowFocus: true,
      refetchInterval: (query) => query.state.data?.pending ? 3000 : false,
    },
  });

  useEffect(() => {
    setSelectedToken(requestedToken ?? '');
    setNotifyFeedback('');
    setNotifyError(false);
  }, [token, requestedToken]);

  useEffect(() => {
    if (window.location.hash !== '#owner-notify-followers' || scrolledFor.current === token) return;
    scrolledFor.current = token;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById('owner-notify-followers');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [token, invite.showEvents, upcoming.length]);

  const send = async () => {
    if (!selected || notify.isPending || sendingToken) return;
    if (progress.data?.remaining === 0) {
      await progress.refetch();
      return;
    }
    if (!window.confirm(`Notify followers about “${selected.title}”? This attempts a one-time notification to every follower who separately enabled pre-event alerts on their own device. Following or enabling Game Day Live alone does not opt them in. It cannot confirm delivery or a read.`)) return;
    setNotifyFeedback('');
    setNotifyError(false);
    setSendingToken(selected.shareToken);
    try {
      let result = await notify.mutateAsync({ inviteToken: token, shareToken: selected.shareToken });
      let lastChangeAt = Date.now();
      let lastSnapshot = '';
      // Continue only after the previous batch has finished. If an attempt is
      // still unresolved after the deadline, let the owner resume unclaimed devices.
      while (true) {
        queryClient.setQueryData(getGetAthleteInviteEventNotificationProgressQueryKey(token, selected.shareToken), result);
        if (result.remaining === 0 && result.pending === 0) break;
        const snapshot = `${result.sent}/${result.failed}/${result.pending}/${result.remaining}`;
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          lastChangeAt = Date.now();
        } else if (Date.now() - lastChangeAt > 25_000) {
          break;
        }
        if (result.pending > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          result = await getAthleteInviteEventNotificationProgress(token, selected.shareToken);
        } else {
          result = await notify.mutateAsync({ inviteToken: token, shareToken: selected.shareToken });
        }
      }
      setNotifyFeedback(result.remaining || result.pending
        ? 'Some devices have not finished. You can continue the remaining devices; unresolved attempts will not be sent again.'
        : 'Announcement attempts finished. Sending to a notification service does not confirm device delivery or a read.');
    } catch {
      setNotifyError(true);
      setNotifyFeedback('Progress could not be refreshed. Previous attempts may have succeeded. Check the report and continue remaining devices; attempts already claimed will not be repeated.');
    } finally {
      setSendingToken('');
      await queryClient.invalidateQueries({
        queryKey: getGetAthleteInviteEventNotificationProgressQueryKey(token, selected.shareToken),
      });
    }
  };

  return (
    <section
      id="owner-notify-followers"
      tabIndex={-1}
      aria-labelledby="owner-events-title"
      className="mt-8 scroll-mt-6 border border-[#8ecbff70] bg-[#102b4d] p-5 text-[#edf3f6] sm:p-7"
      data-testid="section-owner-notify-followers"
    >
      <div className="flex items-start gap-3">
        <CalendarDays className="mt-1 h-6 w-6 shrink-0 text-[#ff7849]" aria-hidden="true" />
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#8ecbff]">HYPE Card / Events</p>
          <h3 id="owner-events-title" className="mt-2 font-display text-3xl uppercase leading-none">Notify followers</h3>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#b9cede]">
            Send a one-time notification attempt for an upcoming game to followers who separately enabled pre-event alerts on their own device. Game Day Live alerts alone do not opt them in. A push attempt does not confirm delivery or a read.
          </p>
        </div>
      </div>
      {!invite.showEvents ? (
        <p className="mt-5 border-l-2 border-[#ff7849] bg-[#071b31] p-4 text-sm text-[#b9cede]">
          Turn on “Allow events” in Visible Sections to share Event Cards and enable event announcements.
        </p>
      ) : upcoming.length ? (
        <div className="mt-5">
          <label htmlFor="owner-notify-game" className="block text-[10px] font-extrabold uppercase tracking-[.2em] text-[#8ecbff]">Upcoming game</label>
          <select
            id="owner-notify-game"
            value={validSelection}
            disabled={!!sendingToken}
            onChange={(event) => { setSelectedToken(event.currentTarget.value); setNotifyFeedback(''); }}
            className="mt-2 min-h-11 w-full border border-[#8ecbff80] bg-[#071b31] px-3 text-sm text-[#edf3f6]"
            data-testid="select-owner-notify-game"
          >
            {upcoming.map((event) => (
              <option key={event.shareToken} value={event.shareToken}>
                {event.title} · {event.date}{event.opponent ? ` · vs ${event.opponent}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!!sendingToken}
            onClick={() => void send()}
            className="mt-4 inline-flex min-h-11 items-center gap-2 border border-[#ff7849] px-5 text-xs font-extrabold uppercase tracking-widest text-[#ffcfbd] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-notify-event-followers"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {sendingToken ? 'Checking announcement progress…' : progress.data?.remaining === 0 ? 'Refresh announcement report' : progress.data?.remaining && progress.data.remaining < progress.data.eligible ? 'Continue remaining devices' : 'Review and notify followers'}
          </button>
          {progress.data && (
            <p role="status" aria-live="polite" className="mt-3 text-sm leading-relaxed text-[#b9cede]" data-testid="progress-owner-notify-followers">
              Eligible now: {progress.data.eligible}. Sent to notification services: {progress.data.sent}. Failed: {progress.data.failed}. In progress or outcome unknown: {progress.data.pending}. Not yet attempted: {progress.data.remaining}. Claimed devices are not retried, even if an attempt was interrupted. Delivery and reads cannot be confirmed.
            </p>
          )}
          {progress.isError && <p role="alert" className="mt-2 text-sm text-[#ffcfbd]">The announcement report could not be loaded. Try refreshing this page before continuing.</p>}
        </div>
      ) : (
        <p className="mt-5 text-sm text-[#b9cede]">There are no upcoming Event Cards to announce.</p>
      )}
      {notifyFeedback && (
        <p role={notifyError ? 'alert' : 'status'} aria-live="polite" className="mt-4 border-l-2 border-[#ff7849] bg-[#071b31] p-4 text-sm leading-relaxed" data-testid="status-owner-notify-followers">
          {notifyFeedback}
        </p>
      )}
    </section>
  );
}