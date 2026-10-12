import {
  getGetAdminSupportTicketQueryKey,
  getListAdminSupportEmailReplyRejectionsQueryKey,
  getListAdminSupportTicketsQueryKey,
  useCreateAdminSupportTicketReply,
  useGetAdminSupportTicket,
  useListAdminSupportEmailReplyRejections,
  useListAdminSupportTickets,
  useUpdateAdminSupportTicket,
  type SupportEmailReplyRejectionReason,
  type SupportTicket,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Inbox, RefreshCw, Send } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { getSupportIssue } from './support-center-model';
import { SupportTicketAttachments } from './support-ticket-attachments';

type Status = 'unread' | 'active' | 'resolved';
const STATUSES: Status[] = ['unread', 'active', 'resolved'];
const LABEL: Record<Status, string> = { unread: 'Unread', active: 'Active', resolved: 'Resolved' };
const SIZE = 20;
const when = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const chip = (s: Status) => (s === 'unread' ? 'admin-chip admin-chip-warn' : s === 'resolved' ? 'admin-chip' : 'admin-chip admin-chip-danger');

const REJECTION_REASON_LABEL: Record<SupportEmailReplyRejectionReason, string> = {
  unknown_reply_address: 'No support ticket matched the reply address',
  unmatched_legacy_thread: 'No support conversation could be verified',
  ambiguous_reply_address: 'The reply address matched multiple possible conversations',
  sender_mismatch: 'The sender did not match the ticket reply address',
};
function Detail({ ticketId, onChanged }: { ticketId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const detail = useGetAdminSupportTicket(ticketId, { query: { queryKey: getGetAdminSupportTicketQueryKey(ticketId), staleTime: 0, refetchOnMount: 'always' } });
  const update = useUpdateAdminSupportTicket();
  const reply = useCreateAdminSupportTicketReply();
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const t: SupportTicket | undefined = detail.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetAdminSupportTicketQueryKey(ticketId) });
    onChanged();
  };
  const setStatus = (status: Status) => {
    setMsg(''); setBad(false);
    update.mutate({ ticketId, data: { status } }, {
      onSuccess: () => { setMsg(`Status changed to ${LABEL[status].toLowerCase()}.`); refresh(); },
      onError: () => { setBad(true); setMsg('Status was not changed. Try again.'); },
    });
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || reply.isPending) return;
    setMsg(''); setBad(false);
    reply.mutate({ ticketId, data: { body: body.trim() } }, {
      onSuccess: (m) => {
        setBody('');
        setBad(m.deliveryStatus === 'failed');
        setMsg(m.deliveryStatus === 'failed' ? 'Reply saved in the ticket, but the email could not be delivered.' : 'Reply saved and emailed to the member.');
        refresh();
      },
      onError: () => { setBad(true); setMsg('Reply was not saved. Your text is still in the box.'); },
    });
  };

  if (detail.isLoading) return <section className="admin-card admin-section" role="status" aria-label="Loading ticket"><div className="admin-skeleton w-1/3" /><div className="admin-skeleton mt-4 w-2/3" /></section>;
  if (detail.isError || !t) return <section className="admin-card admin-section" role="alert"><div className="admin-error">This ticket could not be loaded.</div><button className="admin-button mt-3" type="button" onClick={() => void detail.refetch()}>Try again</button></section>;

  return (
    <section className="admin-card admin-section" aria-labelledby="ticket-detail-heading">
      <p className="admin-eyebrow">Ticket</p>
      <h3 id="ticket-detail-heading" className="admin-display admin-section-title mt-1 break-all">{t.reference}</h3>
      <p className="mt-2 break-all text-sm text-[#60778a]">{getSupportIssue(t.issueId).label} · {t.replyEmail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="admin-chip">Device: {t.deviceType}</span><span className="admin-chip">Connection: {t.connectionType}</span>
        {t.diagnostics && <span className="admin-chip">Checks: {t.diagnostics.connection} / {t.diagnostics.browserStorage} / {t.diagnostics.service}</span>}
      </div>
      <div className="mt-4" role="group" aria-label="Ticket status">
        <span className="admin-label">Status</span>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button key={s} type="button" className={`admin-button ${t.status === s ? 'admin-button-primary' : ''}`} aria-pressed={t.status === s} disabled={update.isPending || t.status === s} onClick={() => setStatus(s)} data-testid={`button-ticket-status-${s}`}>
              {t.status === s && <Check className="h-4 w-4" />}{LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <ol className="mt-5 space-y-3" aria-label="Conversation">
        <li className="border border-[#e5ebe7] bg-white/70 p-3"><p className="admin-label">Member · {when(t.createdAt)}</p><p className="whitespace-pre-wrap break-words text-sm">{t.description}</p></li>
        {t.messages.map((m) => (
          <li key={m.id} className={`border p-3 ${m.senderRole === 'admin' ? 'border-[#bcd3e6] bg-[#eef5fb]' : 'border-[#e5ebe7] bg-white/70'}`}>
            <p className="admin-label">{m.senderRole === 'admin' ? 'Administrator' : 'Member'} · {when(m.createdAt)}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
            <SupportTicketAttachments attachments={m.attachments} />
            {m.senderRole === 'admin' && m.deliveryStatus === 'sent' && <p className="mt-2 flex items-center gap-1 text-xs font-bold text-[#286044]"><Check className="h-3.5 w-3.5" />Email sent</p>}
            {m.senderRole === 'admin' && m.deliveryStatus === 'failed' && <p className="mt-2 flex items-start gap-1 text-xs font-bold text-[#a33e25]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Email failed. The reply remains saved in the ticket and the member can read it there.</p>}
          </li>
        ))}
      </ol>
      <form className="mt-5" onSubmit={send}>
        <label htmlFor="admin-reply"><span className="admin-label">Reply (saved to ticket and emailed to member)</span></label>
        <textarea id="admin-reply" className="admin-input min-h-28 resize-y" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} data-testid="textarea-admin-reply" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="admin-button admin-button-primary" type="submit" disabled={!body.trim() || reply.isPending} data-testid="button-admin-reply"><Send className="h-4 w-4" />{reply.isPending ? 'Sending…' : 'Send reply'}</button>
          <p role={bad ? 'alert' : 'status'} aria-live="polite" className={`text-xs font-bold ${bad ? 'text-[#a33e25]' : 'text-[#2868a0]'}`}>{msg}</p>
        </div>
      </form>
    </section>
  );
}

export function AdminHelpDesk() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Status[]>(['unread', 'active']);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState('');
  const params = useMemo(() => ({ limit: SIZE, offset, ...(selected.length ? { status: selected } : {}) }), [selected, offset]);
  const list = useListAdminSupportTickets(params, { query: { queryKey: getListAdminSupportTicketsQueryKey(params), staleTime: 0, refetchOnMount: 'always' } });
  const rejections = useListAdminSupportEmailReplyRejections({
    query: {
      queryKey: getListAdminSupportEmailReplyRejectionsQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchInterval: 60_000,
    },
  });
  const counts = list.data?.counts;
  const toggle = (s: Status) => { setOffset(0); setSelected((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s])); };
  const changed = () => void qc.invalidateQueries({ queryKey: ['/api/admin/support/tickets'] });

  return (
    <section className="admin-card admin-section" aria-labelledby="admin-helpdesk-heading" data-testid="admin-help-desk">
      <div className="flex items-start justify-between gap-3">
        <div><p className="admin-eyebrow">Help desk</p><h2 id="admin-helpdesk-heading" className="admin-display admin-section-title mt-1">Support queue</h2></div>
        <button type="button" className="admin-button" onClick={() => { void list.refetch(); void rejections.refetch(); }} aria-label="Refresh support queue and unmatched email replies"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>
      <section className="mt-5 border border-[#e5c6aa] bg-[#fff9f3] p-4" aria-labelledby="unmatched-email-replies-heading" data-testid="support-email-rejections">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="admin-eyebrow">Email follow-up</p>
            <h3 id="unmatched-email-replies-heading" className="admin-display mt-1 text-lg">Unmatched email replies</h3>
            <p className="mt-1 text-xs text-[#60778a]">Recent replies that were not added to a ticket. Records expire after 30 days and contain no sender address or message text.</p>
          </div>
          <span className="admin-chip admin-chip-warn">{rejections.data?.items.length ?? '–'} recent</span>
        </div>
        {rejections.isLoading ? (
          <p className="mt-3 text-sm text-[#60778a]" role="status">Loading unmatched email replies…</p>
        ) : rejections.isError ? (
          <p className="mt-3 text-sm font-bold text-[#a33e25]" role="alert">Unmatched email replies could not be loaded. <button type="button" className="underline" onClick={() => void rejections.refetch()}>Try again</button></p>
        ) : rejections.data?.items.length ? (
          <ul className="mt-3 divide-y divide-[#ead8c8] border-y border-[#ead8c8]">
            {rejections.data.items.map((item) => (
              <li key={item.emailProviderId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3" data-testid={`support-email-rejection-${item.emailProviderId}`}>
                <div>
                  <p className="text-sm font-bold text-[#663f26]">{REJECTION_REASON_LABEL[item.reason]}</p>
                  <p className="mt-1 text-xs text-[#60778a]">Provider reference: <span className="admin-mono break-all">{item.emailProviderId}</span></p>
                </div>
                <time className="text-xs text-[#60778a]" dateTime={item.rejectedAt}>{when(item.rejectedAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[#60778a]" role="status">No unmatched email replies in the last 30 days.</p>
        )}
      </section>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={selected.includes(s)} onClick={() => toggle(s)} className={`admin-button ${selected.includes(s) ? 'admin-button-primary' : ''}`} data-testid={`filter-ticket-${s}`}>
            {LABEL[s]} <span className="admin-mono">{counts ? counts[s] : '–'}</span>
          </button>
        ))}
      </div>
      {selected.length === 0 && <p className="mt-2 text-xs text-[#60778a]">No status selected, showing all tickets.</p>}
      <div className="admin-grid">
        <div>
          {list.isLoading ? (
            <div className="space-y-3" role="status" aria-label="Loading tickets">{[0, 1, 2].map((k) => <div className="admin-skeleton" key={k} />)}</div>
          ) : list.isError ? (
            <div className="admin-error" role="alert">The queue could not load. <button className="font-bold underline" type="button" onClick={() => void list.refetch()}>Try again</button></div>
          ) : !list.data?.items.length ? (
            <div className="border border-dashed border-[#c9d6d1] px-4 py-8 text-center" role="status"><Inbox className="mx-auto h-6 w-6 text-[#2868a0]" /><p className="mt-2 text-sm font-bold">Nothing in this view</p><p className="mt-1 text-xs text-[#60778a]">Try another status filter.</p></div>
          ) : (
            <ul className="divide-y divide-[#e5ebe7] border border-[#e5ebe7]">
              {list.data.items.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setOpenId(t.id)} aria-current={openId === t.id} className={`flex w-full flex-col gap-1 p-3 text-left transition-colors hover:bg-[#f1f6f3] ${openId === t.id ? 'bg-[#e8f0f6]' : ''}`} data-testid={`row-ticket-${t.id}`}>
                    <span className="flex items-center justify-between gap-2"><span className="admin-mono break-all text-xs font-extrabold">{t.reference}</span><span className={chip(t.status)}>{LABEL[t.status]}</span></span>
                    <span className="text-sm font-bold">{getSupportIssue(t.issueId).label}</span>
                    <span className="line-clamp-2 text-xs text-[#60778a]">{t.description}</span>
                    <span className="text-[10px] text-[#82939d]">Updated {when(t.updatedAt)} · {t.messages.length} message{t.messages.length === 1 ? '' : 's'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.data && list.data.totalCount > SIZE && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-[#60778a]">{offset + 1}–{Math.min(offset + list.data.items.length, list.data.totalCount)} of {list.data.totalCount}</p>
              <div className="flex gap-2">
                <button className="admin-button !min-h-8 !px-2" type="button" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - SIZE))} aria-label="Previous tickets"><ChevronLeft className="h-4 w-4" /></button>
                <button className="admin-button !min-h-8 !px-2" type="button" disabled={offset + SIZE >= list.data.totalCount} onClick={() => setOffset(offset + SIZE)} aria-label="Next tickets"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>
        {openId ? <Detail key={openId} ticketId={openId} onChanged={changed} /> : (
          <div className="border border-dashed border-[#c9d6d1] p-6 text-sm text-[#60778a]">Select a ticket to read the conversation, change its status, or reply.</div>
        )}
      </div>
    </section>
  );
}
