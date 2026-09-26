import {
  useGetHypeCardReplyInbox,
  useMarkHypeCardReplyInboxRead,
  useDeleteHypeCardShareReply,
  getGetHypeCardReplyInboxQueryKey,
  getListAthleteInvitesQueryKey,
  getListAthleteInviteHypesQueryKey,
  useListAthleteInvites,
  useListAthleteInviteHypes,
} from '@workspace/api-client-react';
import type {
  HypeCardReplyInbox,
  HypeCardReplyInboxGroup,
  HypeCardShareReply,
} from '@workspace/api-client-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ArrowRight, MessageCircleHeart, Trash2, Loader2, AlertTriangle, Inbox } from 'lucide-react';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getLatestFanActivity } from './fan-activity-model';

export function HypeCardReplyInboxTrigger({ className = '', variant = 'supporter' }: { className?: string, variant?: 'supporter' | 'dashboard' }) {
  const [open, setOpen] = useState(false);
  const [targetToken, setTargetToken] = useState<string | null>(null);
  const { isSignedIn } = useUser();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('replies');
    if (token) {
      setTargetToken(token);
      setOpen(true);
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('replies');
      const qs = newParams.toString();
      const cleanUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []); // Run on mount

  const { data, isLoading: repliesLoading, isError: repliesError } = useGetHypeCardReplyInbox({
    query: {
      staleTime: 15000,
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
      queryKey: getGetHypeCardReplyInboxQueryKey(),
    },
  });
  const { data: ownedInvites, isLoading: invitesLoading, isError: invitesError } = useListAthleteInvites({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListAthleteInvitesQueryKey(),
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
  });
  const inviteToken = ownedInvites?.[0]?.inviteToken ?? '';
  const { data: fanHypes, isLoading: hypesLoading, isError: hypesError } = useListAthleteInviteHypes(inviteToken, {
    query: {
      enabled: Boolean(isSignedIn && inviteToken),
      queryKey: getListAthleteInviteHypesQueryKey(inviteToken),
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
      refetchOnMount: 'always',
    },
  });

  const queryClient = useQueryClient();
  const markRead = useMarkHypeCardReplyInboxRead({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey: getGetHypeCardReplyInboxQueryKey() });
        const previousData = queryClient.getQueryData<HypeCardReplyInbox>(getGetHypeCardReplyInboxQueryKey());
        
        queryClient.setQueryData<HypeCardReplyInbox>(getGetHypeCardReplyInboxQueryKey(), (old) => {
          if (!old) return old;
          return {
            ...old,
            unreadCount: 0,
            groups: old.groups.map((g) => ({
              ...g,
              unreadCount: 0,
              replies: g.replies.map((r) => ({ ...r, isRead: true })),
            })),
          };
        });

        return { previousData };
      },
      onError: (_error, _variables, context) => {
        if (context?.previousData) {
          queryClient.setQueryData(getGetHypeCardReplyInboxQueryKey(), context.previousData);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetHypeCardReplyInboxQueryKey() });
      },
    },
  });

  const markReadPending = useRef(false);
  markReadPending.current = markRead.isPending;

  useEffect(() => {
    if (open && data?.unreadCount && data.unreadCount > 0 && !markReadPending.current) {
      markRead.mutate();
    }
  }, [open, data?.unreadCount, markRead]);

  const isLoading = repliesLoading || (Boolean(isSignedIn) && (invitesLoading || (Boolean(inviteToken) && hypesLoading)));
  const isError = repliesError || (Boolean(isSignedIn) && (invitesError || (Boolean(inviteToken) && hypesError)));
  const unreadCount = data?.unreadCount ?? 0;
  const totalCount = (data?.totalCount ?? 0) + (fanHypes?.length ?? 0);
  const latestActivity = useMemo(() => getLatestFanActivity(fanHypes, data), [data, fanHypes]);

  const triggerContent = variant === 'dashboard' ? (
    <button
      type="button"
      className={`reply-inbox-summary-trigger ${className}`}
      aria-label={`Open Hypes and replies, ${totalCount} ${totalCount === 1 ? 'message' : 'messages'}`}
      data-testid="btn-reply-inbox"
    >
      <span className="reply-inbox-summary-trigger__header">
        <span className="reply-inbox-summary-trigger__label">
          <MessageCircleHeart size={15} aria-hidden="true" />
          <span>Hypes & replies · <span data-testid="reply-inbox-total-count">{isLoading ? '…' : isError ? '—' : totalCount}</span></span>
        </span>
        {unreadCount > 0 && (
          <span className="reply-inbox-summary-trigger__unread">{unreadCount} new</span>
        )}
      </span>
      {isLoading && latestActivity.length === 0 ? (
        <span className="reply-inbox-summary-trigger__empty">Loading recent Hypes…</span>
      ) : isError && latestActivity.length === 0 ? (
        <span className="reply-inbox-summary-trigger__empty">Hypes or replies are unavailable right now.</span>
      ) : latestActivity.length > 0 ? (
        <span className="reply-inbox-summary-trigger__items">
          {latestActivity.map(({ id, reaction, title, message }) => (
            <span className="reply-inbox-summary-trigger__item" key={id}>
              <span className="reply-inbox-summary-trigger__reaction" aria-hidden="true">{reaction}</span>
              <span className="reply-inbox-summary-trigger__copy">
                <span className="reply-inbox-summary-trigger__share-title">{title}</span>
                <span className="reply-inbox-summary-trigger__message">{message}</span>
              </span>
            </span>
          ))}
        </span>
      ) : (
        <span className="reply-inbox-summary-trigger__empty">Hypes and replies will show up here.</span>
      )}
      <span className="reply-inbox-summary-trigger__footer">
        View all <ArrowRight size={14} aria-hidden="true" />
      </span>
    </button>
  ) : (
    <button
      type="button"
      className={`group flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        'text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-5 py-3 clip-angled-sm w-full justify-between'
      } ${className}`}
      data-testid="btn-reply-inbox"
    >
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
        <MessageCircleHeart className={`h-4 w-4 ${unreadCount > 0 ? 'text-primary animate-pulse' : ''}`} />
        <span>{isLoading ? '...' : isError ? 'Error' : `${totalCount} Hypes & Replies`}</span>
      </div>
      {unreadCount > 0 && (
        <span className="flex h-5 items-center justify-center bg-primary px-2 text-[10px] font-bold text-primary-foreground clip-angled-sm">
          {unreadCount} NEW
        </span>
      )}
    </button>
  );

  const activeGroups = useMemo(() => {
    return data?.groups.filter((g) => g.replies.length > 0) || [];
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerContent}</DialogTrigger>
      <DialogContent className="w-[92vw] sm:w-[90vw] max-w-2xl max-h-[85vh] border-primary bg-[#111316] text-white p-0 overflow-hidden flex flex-col clip-angled-sm sm:clip-angled">
        <DialogHeader className="p-4 sm:p-6 border-b border-white/10 shrink-0 bg-foreground">
          <DialogTitle className="font-display text-3xl tracking-wide uppercase text-white flex items-center gap-3">
            <Inbox className="h-6 w-6 text-primary" />
            Hypes &amp; Replies
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Fan Hypes and replies to shared moments.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 bg-tech-grid-dark relative">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/50 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-bold uppercase tracking-widest">Loading Hypes and replies...</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center py-12 text-destructive gap-4 text-center">
              <AlertTriangle className="h-10 w-10 mb-2" />
              <p className="font-bold uppercase tracking-widest">Failed to load</p>
              <p className="text-sm text-white/50 max-w-sm">Some Hypes or replies could not be loaded. Please try again.</p>
            </div>
          )}

          {inviteToken && fanHypes && fanHypes.length > 0 && (
            <section aria-labelledby="inbox-fan-hypes" className="border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="inbox-fan-hypes" className="font-display text-xl uppercase tracking-wide">Fan Hypes</h3>
                <a
                  href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/player/${encodeURIComponent(inviteToken)}/manage#owner-fan-hypes`}
                  className="text-xs font-bold text-primary hover:underline"
                >Manage Hypes</a>
              </div>
              <ul className="mt-3 space-y-3">
                {fanHypes.map((hype) => (
                  <li key={hype.id} className="flex gap-3 border-t border-white/10 pt-3">
                    <span className="text-2xl" aria-hidden="true">{hype.reaction}</span>
                    <div className="min-w-0">
                      <p className="break-words text-xs font-bold text-white/65">{hype.senderName || 'Anonymous fan'} · {formatDistanceToNow(parseISO(hype.createdAt), { addSuffix: true })}</p>
                      {hype.message && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/90">{hype.message}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data && activeGroups.length === 0 && !fanHypes?.length && !isLoading && !isError && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 bg-white/5 flex items-center justify-center rounded-full mb-4">
                <MessageCircleHeart className="h-8 w-8 text-white/20" />
              </div>
              <p className="font-display text-2xl uppercase tracking-wide text-white/50">It's quiet here</p>
              <p className="mt-2 text-sm text-white/40 max-w-xs font-medium">When fans send Hypes or reply to shared media, their messages will appear here.</p>
            </div>
          )}

          {data && activeGroups.length > 0 && (
            <section aria-label="Media replies" className="space-y-6">
              <h3 className="font-display text-xl uppercase tracking-wide">Media replies</h3>
              {activeGroups.map((group) => (
                <ReplyGroup key={group.shareToken} group={group} isTarget={group.shareToken === targetToken} />
              ))}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReplyGroup({ group, isTarget }: { group: HypeCardReplyInboxGroup; isTarget: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isTarget && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isTarget]);

  return (
    <div
      ref={ref}
      className={`border transition-colors ${
        isTarget ? 'border-primary bg-primary/5' : 'border-white/10 bg-white/5'
      } p-4 clip-angled-sm`}
    >
      <div className="flex items-start justify-between mb-4 border-b border-white/10 pb-3">
        <div>
          <h3 className="font-display text-xl uppercase tracking-wide text-white flex items-center gap-2">
            {group.title}
            {group.unreadCount > 0 && (
              <span className="flex h-5 items-center justify-center bg-primary px-2 text-[10px] font-bold text-primary-foreground clip-angled-sm leading-none">
                {group.unreadCount} NEW
              </span>
            )}
          </h3>
          <p className="text-xs font-bold uppercase tracking-widest text-white/50 mt-1">
            Sent {formatDistanceToNow(parseISO(group.sentAt), { addSuffix: true })}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {group.replies.map((reply) => (
          <ReplyItem key={reply.id} reply={reply} shareToken={group.shareToken} />
        ))}
      </div>
    </div>
  );
}

function ReplyItem({ reply, shareToken }: { reply: HypeCardShareReply; shareToken: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const deleteReply = useDeleteHypeCardShareReply({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey: getGetHypeCardReplyInboxQueryKey() });
        const previousData = queryClient.getQueryData<HypeCardReplyInbox>(getGetHypeCardReplyInboxQueryKey());
        
        queryClient.setQueryData<HypeCardReplyInbox>(getGetHypeCardReplyInboxQueryKey(), (old) => {
          if (!old) return old;
          
          const wasUnread = !reply.isRead;
          return {
            ...old,
            totalCount: Math.max(0, old.totalCount - 1),
            unreadCount: wasUnread ? Math.max(0, old.unreadCount - 1) : old.unreadCount,
            groups: old.groups.map((g) => {
              if (g.shareToken === shareToken) {
                return {
                  ...g,
                  unreadCount: wasUnread ? Math.max(0, g.unreadCount - 1) : g.unreadCount,
                  replies: g.replies.filter((r) => r.id !== reply.id),
                };
              }
              return g;
            }),
          };
        });

        return { previousData };
      },
      onError: (_error, _variables, context) => {
        if (context?.previousData) {
          queryClient.setQueryData(getGetHypeCardReplyInboxQueryKey(), context.previousData);
        }
        toast({
          title: 'Could not delete reply',
          description: 'There was a problem removing this reply. Please try again.',
          variant: 'destructive',
        });
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetHypeCardReplyInboxQueryKey() });
      },
    },
  });

  return (
    <div className="group/reply flex items-start gap-3 rounded bg-black/20 p-3 hover:bg-black/40 transition-colors">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-white/10 text-2xl clip-angled-sm">
        {reply.reaction}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-1">
          {formatDistanceToNow(parseISO(reply.createdAt), { addSuffix: true })}
          {!reply.isRead && <span className="ml-2 text-primary font-extrabold">• NEW</span>}
        </p>
        {reply.message && (
          <p className="text-sm font-medium text-white/90 break-words">{reply.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => deleteReply.mutate({ shareToken, replyId: reply.id })}
        className="shrink-0 p-3 -m-1 sm:p-2 sm:-m-0 text-white/40 hover:text-destructive transition-colors focus-visible:opacity-100 sm:opacity-0 sm:group-hover/reply:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        aria-label="Delete reply"
        disabled={deleteReply.isPending}
      >
        <Trash2 className="h-4 w-4 sm:h-4 sm:w-4" />
      </button>
    </div>
  );
}
