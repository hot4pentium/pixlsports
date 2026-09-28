import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CalendarDays, Bell } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetAthleteFanCardQueryKey,
  getGetAthleteInviteEventLinksQueryKey,
  getAthleteInviteEventNotificationProgress,
  getGetAthleteInviteEventNotificationProgressQueryKey,
  getListAthleteInvitesQueryKey,
  useGetAthleteInviteEventLinks,
  useGetAthleteInviteEventNotificationProgress,
  useListOwnedGameOnCards,
  useNotifyAthleteInviteEventFollowers,
  useReplaceAthleteInviteEventLinks,
  type OwnedAthleteInvite,
} from '@workspace/api-client-react';
import { gameOnHref } from './athlete-event-links';

export function OwnerEventLinks({ invite }: { invite: OwnedAthleteInvite }) {
  const token = invite.inviteToken;
  const queryClient = useQueryClient();
  const links = useGetAthleteInviteEventLinks(token, {
    query: { queryKey: getGetAthleteInviteEventLinksQueryKey(token), enabled: !!token, refetchOnWindowFocus: true },
  });
  const cards = useListOwnedGameOnCards();
  const replace = useReplaceAthleteInviteEventLinks();
  const notify = useNotifyAthleteInviteEventFollowers();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);
  const [notifyFeedback, setNotifyFeedback] = useState('');
  const [notifyError, setNotifyError] = useState(false);
  const [sendingToken, setSendingToken] = useState('');
  const requestedToken = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('shareToken') : null;
  const [selectedToken, setSelectedToken] = useState(requestedToken ?? '');
  const initializedFor = useRef('');
  const scrolledFor = useRef('');

  useEffect(() => {
    if (initializedFor.current === token || !links.data) return;
    initializedFor.current = token;
    setDraft(links.data.shareTokens);
    setSelectedToken(requestedToken ?? '');
    setFeedback('');
    setNotifyFeedback('');
  }, [token, links.data, requestedToken]);

  const savedTokens = links.data?.shareTokens ?? [];
  const upcoming = invite.events.filter((event) => event.type === 'game' && event.status === 'upcoming' && savedTokens.includes(event.shareToken));
  const validSelection = upcoming.some((event) => event.shareToken === selectedToken) ? selectedToken : (upcoming[0]?.shareToken ?? '');
  const selected = upcoming.find((event) => event.shareToken === validSelection);
  const available = cards.data ?? [];
  const availableTokens = new Set(available.map((card) => card.shareToken));
  const currentDraft = draft ?? savedTokens;
  const validDraft = currentDraft.filter((shareToken) => availableTokens.has(shareToken));
  const hasUnavailableSavedCards = savedTokens.some((shareToken) => !availableTokens.has(shareToken));
  const dirty = [...validDraft].sort().join('\0') !== [...savedTokens].sort().join('\0');
  const progress = useGetAthleteInviteEventNotificationProgress(token, validSelection, {
    query: {
      queryKey: getGetAthleteInviteEventNotificationProgressQueryKey(token, validSelection),
      enabled: !!token && !!validSelection && !dirty,
      refetchOnWindowFocus: true,
      refetchInterval: (query) => query.state.data?.pending ? 3000 : false,
    },
  });

  useEffect(() => {
    if (window.location.hash !== '#owner-notify-followers' || links.isLoading || cards.isLoading || !links.data || !cards.data) return;
    if (scrolledFor.current === token) return;
    scrolledFor.current = token;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById('owner-notify-followers');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [token, links.isLoading, cards.isLoading, links.data, cards.data]);

  const save = async () => {
    if (!dirty || replace.isPending || cards.isError || links.isError) return;
    setFeedback('');
    setFeedbackError(false);
    try {
      const result = await replace.mutateAsync({ inviteToken: token, data: { shareTokens: validDraft } });
      setDraft(result.shareTokens);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAthleteInviteEventLinksQueryKey(token) }),
        queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(token) }),
      ]);
      setFeedback('Events updated on the living card.');
    } catch {
      setFeedbackError(true);
      setFeedback('Events could not be saved. Your selection is still here; try again.');
    }
  };

  const send = async () => {
    if (!selected || notify.isPending || sendingToken || dirty) return;
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
      // still unresolved after the deadline, leave its claim intact and let
      // the owner resume the unclaimed devices explicitly.
      while (true) {
        queryClient.setQueryData(getGetAthleteInviteEventNotificationProgressQueryKey(token, selected.shareToken), result);
        if (result.remaining === 0 && result.pending === 0) break;
        const snapshot = `${result.sent}/${result.failed}/${result.pending}/${result.remaining}`;
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          lastChangeAt = Date.now();
        } else if (Date.now() - lastChangeAt > 25_000) break;
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
      await queryClient.invalidateQueries({ queryKey: getGetAthleteInviteEventNotificationProgressQueryKey(token, selected.shareToken) });
    }
  };

  return (
    <section id="owner-notify-followers" tabIndex={-1} aria-labelledby="owner-events-title" className="mt-8 scroll-mt-6 border border-[#8ecbff70] bg-[#102b4d] p-5 text-[#edf3f6] sm:p-7" data-testid="section-owner-notify-followers">
      <div className="flex items-start gap-3">
        <CalendarDays className="mt-1 h-6 w-6 shrink-0 text-[#ff7849]" aria-hidden="true" />
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#8ecbff]">The living card / Events</p>
          <h2 id="owner-events-title" className="mt-2 font-display text-4xl uppercase leading-none">Link game days.</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#b9cede]">Choose which of your shared Game On Cards appear on the athlete’s public card. Unchecking a card removes it from Events, not from its original share link.</p>
        </div>
      </div>
      {links.isLoading || cards.isLoading ? (
        <div className="mt-6 space-y-2" role="status" aria-label="Loading your Game On Cards"><div className="h-16 animate-pulse bg-[#234669]" /><div className="h-16 animate-pulse bg-[#234669]" /><span className="sr-only">Loading your Game On Cards</span></div>
      ) : links.isError || cards.isError ? (
        <div className="mt-6 border-l-2 border-[#ff7849] bg-[#071b31] p-4" role="alert">
          <p className="text-sm">Your event links could not be loaded. Nothing has changed.</p>
          <button type="button" onClick={() => { void links.refetch(); void cards.refetch(); }} className="mt-3 min-h-11 border border-[#8ecbff] px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-retry-owner-events">Try again</button>
        </div>
      ) : (
        <>
          {hasUnavailableSavedCards && <p role="status" className="mt-5 border-l-2 border-[#ff7849] px-3 text-xs leading-relaxed text-[#ffcfbd]">Some previously linked cards are no longer in your shared Game On Cards. They will be removed if you save these selections.</p>}
          {available.length ? (
            <fieldset className="mt-6">
              <legend className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#8ecbff]">Your shared Game On Cards</legend>
              <div className="mt-3 space-y-2">
                {available.map((card) => {
                  const event = card.events[0];
                  const checked = currentDraft.includes(card.shareToken);
                  return <div key={card.shareToken} className={`flex items-start gap-3 border p-4 ${checked ? 'border-[#ff7849] bg-[#ff784914]' : 'border-[#8ecbff55] bg-[#071b31]'}`}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[#ff7849]" checked={checked} disabled={replace.isPending} onChange={() => {
                        setFeedback('');
                        setDraft(checked ? currentDraft.filter((value) => value !== card.shareToken) : [...validDraft, card.shareToken]);
                      }} data-testid={`checkbox-owner-event-${card.shareToken}`} />
                      <span className="min-w-0 flex-1">
                        <strong className="block break-words font-display text-xl uppercase">{card.title}</strong>
                        <span className="mt-1 block text-xs leading-relaxed text-[#b9cede]">{event?.type === 'practice' ? 'Practice' : 'Game'} · {event?.date || 'Date not set'}{event?.time ? ` · ${event.time}` : ''}{event?.opponent ? ` · vs ${event.opponent}` : ''}</span>
                      </span>
                    </label>
                    <Link href={gameOnHref(card.shareToken)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-bold text-[#8ecbff] hover:underline" data-testid={`link-owner-game-on-${card.shareToken}`} aria-label={`Open ${card.title} Game On Card in a new tab`}>View <ArrowUpRight className="h-4 w-4" /></Link>
                  </div>;
                })}
              </div>
            </fieldset>
          ) : <p className="mt-6 border border-[#8ecbff55] bg-[#071b31] p-5 text-sm text-[#b9cede]">No shared Game On Cards yet. Mark an individual game or practice as a Game On Card in your schedule, then return here to link it.</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" disabled={!dirty || replace.isPending} onClick={() => void save()} className="min-h-11 bg-[#ff7849] px-5 text-xs font-extrabold uppercase tracking-widest text-[#07172b] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-save-owner-events">{replace.isPending ? 'Saving events…' : 'Save event links'}</button>
            {dirty && <span className="text-xs text-[#b9cede]">Changes are not public until saved.</span>}
          </div>
          {feedback && <p role={feedbackError ? 'alert' : 'status'} className="mt-3 text-sm text-[#ffcfbd]" data-testid="status-owner-event-links">{feedback}</p>}
          <div className="mt-8 border-t border-[#8ecbff55] pt-7">
            <div className="flex items-start gap-3"><Bell className="mt-1 h-5 w-5 shrink-0 text-[#ff7849]" aria-hidden="true" /><div><h3 className="font-display text-2xl uppercase">Notify followers</h3><p className="mt-2 text-sm leading-relaxed text-[#b9cede]">Send a one-time notification attempt for one linked upcoming game to all followers who separately enabled pre-event alerts on their own device. Game Day Live alerts alone do not opt them in. A push attempt does not confirm delivery or a read.</p></div></div>
            {upcoming.length ? (
              <div className="mt-5">
                <label htmlFor="owner-notify-game" className="block text-[10px] font-extrabold uppercase tracking-[.2em] text-[#8ecbff]">Linked upcoming game</label>
                <select id="owner-notify-game" value={validSelection} disabled={!!sendingToken} onChange={(event) => { setSelectedToken(event.currentTarget.value); setNotifyFeedback(''); }} className="mt-2 min-h-11 w-full border border-[#8ecbff80] bg-[#071b31] px-3 text-sm text-[#edf3f6]" data-testid="select-owner-notify-game">
                  {upcoming.map((event) => <option key={event.shareToken} value={event.shareToken}>{event.title} · {event.date}{event.opponent ? ` · vs ${event.opponent}` : ''}</option>)}
                </select>
                <button type="button" disabled={!!sendingToken || dirty} onClick={() => void send()} className="mt-4 min-h-11 border border-[#ff7849] px-5 text-xs font-extrabold uppercase tracking-widest text-[#ffcfbd] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-notify-event-followers">{sendingToken ? 'Checking announcement progress…' : progress.data?.remaining === 0 ? 'Refresh announcement report' : progress.data?.remaining && progress.data.remaining < progress.data.eligible ? 'Continue remaining devices' : 'Review and notify followers'}</button>
                {dirty && <p className="mt-2 text-xs text-[#b9cede]">Save event link changes before notifying followers.</p>}
                {progress.data && <p role="status" aria-live="polite" className="mt-3 text-sm leading-relaxed text-[#b9cede]" data-testid="progress-owner-notify-followers">
                  Eligible now: {progress.data.eligible}. Sent to notification services: {progress.data.sent}. Failed: {progress.data.failed}. In progress or outcome unknown: {progress.data.pending}. Not yet attempted: {progress.data.remaining}. Claimed devices are not retried, even if an attempt was interrupted. Delivery and reads cannot be confirmed.
                </p>}
                {progress.isError && <p role="alert" className="mt-2 text-sm text-[#ffcfbd]">The announcement report could not be loaded. Try refreshing this page before continuing.</p>}
              </div>
            ) : <p className="mt-5 text-sm text-[#b9cede]">Link an upcoming game to this card to make it available for notification.</p>}
            {notifyFeedback && <p role={notifyError ? 'alert' : 'status'} aria-live="polite" className="mt-4 border-l-2 border-[#ff7849] bg-[#071b31] p-4 text-sm leading-relaxed" data-testid="status-owner-notify-followers">{notifyFeedback}</p>}
          </div>
        </>
      )}
    </section>
  );
}