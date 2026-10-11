import {
  getListSupportTicketsQueryKey,
  getGetSupportTicketQueryKey,
  healthCheck,
  useCreateSupportTicket,
  useCreateSupportTicketMessage,
  useGetSupportTicket,
  useListSupportTickets,
  type SupportTicket,
  type SupportTicketInput,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { AlertCircle, Check, ChevronDown, Inbox, LifeBuoy, Lock, Send, Wifi } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  EMPTY_SUPPORT_DIAGNOSTICS,
  getSupportIssue,
  isValidSupportReplyEmail,
  probeBrowserStorage,
  readStoredTicketAccess,
  SUPPORT_ISSUES,
  writeStoredTicketAccess,
  type StoredTicketAccess,
  type SupportDiagnostics,
} from './support-center-model';

const DEVICES = [['mobile', 'Mobile'], ['desktop', 'Desktop'], ['other', 'Other'], ['unsure', 'Not sure']] as const;
const CONNECTIONS = [['wifi', 'Wi-Fi'], ['mobile-data', 'Mobile data'], ['other', 'Other'], ['unsure', 'Not sure']] as const;
const STATUS_COPY = { unread: 'Received', active: 'In progress', resolved: 'Resolved' } as const;
const STATUS_STYLE = {
  unread: 'border-accent/60 bg-accent/15 text-accent',
  active: 'border-primary-ink/60 bg-primary/20 text-primary-ink',
  resolved: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300',
} as const;
const SUPPORT_TICKET_REFRESH_INTERVAL_MS = 10_000;

function diagnosticText(value: string) {
  return ({ online: 'Online', offline: 'Offline', available: 'Available', unavailable: 'Could not confirm' } as Record<string, string>)[value] ?? 'Not checked';
}
function when(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const field = 'min-h-11 w-full border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-accent';

function Segmented<T extends string>({ legend, name, options, value, onChange }: { legend: string; name: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold text-foreground">{legend}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map(([id, label]) => (
          <label key={id} className={`relative flex min-h-11 cursor-pointer items-center justify-center border px-2 text-sm font-semibold transition-all duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${value === id ? 'border-accent bg-accent text-accent-foreground -translate-y-0.5' : 'border-border bg-background/40 text-muted-foreground hover:border-primary-ink hover:text-foreground'}`}>
            <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} className="sr-only" data-testid={`radio-${name}-${id}`} />
            {value === id && <Check aria-hidden className="mr-1.5 h-4 w-4" />}{label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TicketCard({ id, token, preloaded, defaultOpen, onForget }: { id: string; token?: string; preloaded?: SupportTicket; defaultOpen?: boolean; onForget?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const headers = token ? { 'X-Support-Ticket-Token': token } : undefined;
  const fetched = useGetSupportTicket(id, {
    query: {
      enabled: Boolean(token),
      queryKey: getGetSupportTicketQueryKey(id),
      refetchInterval: open ? SUPPORT_TICKET_REFRESH_INTERVAL_MS : false,
      retry: false,
    },
    request: headers ? { headers } : undefined,
  });
  const ticket = fetched.data ?? preloaded;
  const send = useCreateSupportTicketMessage();
  const [body, setBody] = useState('');
  const [feedback, setFeedback] = useState('');
  const [failed, setFeedbackFailed] = useState(false);

  if (!ticket) {
    if (fetched.isError) return (
      <li className="border border-border bg-card/70 p-4 text-sm" role="alert">
        <p className="font-bold">A ticket saved in this browser could not be opened.</p>
        <p className="mt-1 text-muted-foreground">It may have been removed, or the connection dropped.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="min-h-10 border border-border px-3 font-bold hover:border-accent" onClick={() => void fetched.refetch()}>Try again</button>
          {onForget && <button type="button" className="min-h-10 px-3 font-bold text-muted-foreground underline" onClick={onForget}>Forget it on this browser</button>}
        </div>
      </li>
    );
    return <li className="h-20 animate-pulse border border-border bg-card/50" aria-label="Loading ticket" role="status" />;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || send.isPending) return;
    setFeedback('');
    send.mutate({ ticketId: id, data: { body: text }, ...(headers ? { request: { headers } } : {}) } as Parameters<typeof send.mutate>[0], {
      onSuccess: () => {
        setBody(''); setFeedbackFailed(false); setFeedback('Follow-up sent. It is saved in this ticket.');
        void qc.invalidateQueries({ queryKey: getGetSupportTicketQueryKey(id) });
        void qc.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
      },
      onError: () => { setFeedbackFailed(true); setFeedback('Your follow-up was not sent. Your text is still here; try again.'); },
    });
  };

  return (
    <li className="border border-border bg-card/80 transition-colors hover:border-primary-ink/60" data-testid={`ticket-${ticket.id}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-16 w-full items-center gap-3 p-4 text-left">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-bold tracking-wider text-accent">{ticket.reference}</p>
          <p className="truncate text-sm font-bold">{getSupportIssue(ticket.issueId).label}</p>
          <p className="text-xs text-muted-foreground">Opened {when(ticket.createdAt)}</p>
        </div>
        <span className={`border px-2 py-1 text-[10px] font-extrabold uppercase tracking-widest ${STATUS_STYLE[ticket.status]}`} data-testid={`status-ticket-${ticket.id}`}>{STATUS_COPY[ticket.status]}</span>
        <ChevronDown aria-hidden className={`h-5 w-5 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-border p-4">
            <ol className="space-y-3" aria-label={`Conversation for ${ticket.reference}`}>
              <li className="border-l-2 border-accent bg-background/40 p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Your request · {when(ticket.createdAt)}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{ticket.description}</p>
              </li>
              {ticket.messages.map((m) => (
                <li key={m.id} className={`p-3 text-sm ${m.senderRole === 'admin' ? 'border-l-2 border-primary-ink bg-primary/15' : 'ml-4 border-l-2 border-border bg-background/40'}`}>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">{m.senderRole === 'admin' ? 'Pixl Sports' : 'You'} · {when(m.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Replies from Pixl Sports appear here and are also emailed to <span className="font-semibold text-foreground">{ticket.replyEmail}</span>. Replying from your email app does not reach this ticket; add follow-ups here.
            </p>
            {ticket.status === 'resolved' && <p className="mt-2 text-xs font-bold text-emerald-300">Marked resolved. Sending a follow-up lets us know you still need help.</p>}
            <form onSubmit={submit} className="mt-3">
              <label className="block text-sm font-bold" htmlFor={`followup-${ticket.id}`}>Add a follow-up</label>
              <textarea id={`followup-${ticket.id}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={3} className={`${field} mt-2 py-2`} data-testid={`textarea-followup-${ticket.id}`} />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="submit" disabled={!body.trim() || send.isPending} className="inline-flex min-h-11 items-center gap-2 bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0" data-testid={`button-followup-${ticket.id}`}>
                  <Send aria-hidden className="h-4 w-4" />{send.isPending ? 'Sending…' : 'Send follow-up'}
                </button>
                <p role={failed ? 'alert' : 'status'} aria-live="polite" className={`text-sm ${failed ? 'text-destructive' : 'text-emerald-300'}`}>{feedback}</p>
              </div>
            </form>
          </div>
        </div>
      </div>
    </li>
  );
}

export function SupportCenter() {
  const { isSignedIn, user } = useUser();
  const qc = useQueryClient();
  const create = useCreateSupportTicket();
  const owned = useListSupportTickets({ query: {
    enabled: Boolean(isSignedIn),
    queryKey: getListSupportTicketsQueryKey(),
    refetchInterval: isSignedIn ? SUPPORT_TICKET_REFRESH_INTERVAL_MS : false,
    retry: false,
  } });

  const [issueId, setIssueId] = useState<SupportTicketInput['issueId']>('account');
  const [description, setDescription] = useState('');
  const [deviceType, setDeviceType] = useState<SupportTicketInput['deviceType']>('mobile');
  const [connectionType, setConnectionType] = useState<SupportTicketInput['connectionType']>('wifi');
  const [replyEmail, setReplyEmail] = useState('');
  const emailTouched = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics>(EMPTY_SUPPORT_DIAGNOSTICS);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  const [attachChecks, setAttachChecks] = useState(true);
  const [created, setCreated] = useState<{ reference: string; id: string } | null>(null);
  const [createError, setCreateError] = useState('');
  const [stored, setStored] = useState<StoredTicketAccess[]>(() => readStoredTicketAccess());
  const ticketsHeadingRef = useRef<HTMLHeadingElement>(null);

  const goToTickets = () => {
    window.requestAnimationFrame(() => {
      const heading = ticketsHeadingRef.current;
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  };

  const primary = user?.primaryEmailAddress;
  const defaultEmail = primary && primary.verification?.status === 'verified' ? primary.emailAddress : '';
  useEffect(() => {
    if (defaultEmail && !emailTouched.current) setReplyEmail(defaultEmail);
  }, [defaultEmail]);

  const descTrim = description.trim();
  const errors = {
    description: descTrim.length < 10 ? 'Describe the problem in at least 10 characters.' : '',
    email: isValidSupportReplyEmail(replyEmail) ? '' : 'Enter a valid email address.',
  };
  const checksRun = diagnostics.connection !== 'not-run';

  const runChecks = async () => {
    setChecking(true); setCheckMessage('');
    const connection = navigator.onLine ? 'online' : 'offline';
    let browserStorage: SupportDiagnostics['browserStorage'] = 'unavailable';
    try { browserStorage = probeBrowserStorage(window.localStorage, String(Date.now())) ? 'available' : 'unavailable'; } catch { /* unavailable */ }
    let service: SupportDiagnostics['service'] = 'not-run';
    if (connection === 'online') {
      try { service = (await healthCheck({ credentials: 'omit' })).status === 'ok' ? 'available' : 'unavailable'; } catch { service = 'unavailable'; }
    } else setCheckMessage('Service check skipped because this browser reports it is offline.');
    setDiagnostics({ connection, browserStorage, service });
    setChecking(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true); setCreateError('');
    if (errors.description || errors.email || create.isPending) return;
    const data: SupportTicketInput = {
      issueId, description: descTrim, deviceType, connectionType, replyEmail: replyEmail.trim(),
      ...(checksRun && attachChecks ? { diagnostics } : {}),
    };
    create.mutate({ data }, {
      onSuccess: ({ ticket, accessToken }) => {
        setCreated({ reference: ticket.reference, id: ticket.id });
        setConfirmationOpen(true);
        if (isSignedIn) {
          qc.setQueryData<SupportTicket[]>(getListSupportTicketsQueryKey(), (old) => [ticket, ...(old ?? []).filter((t) => t.id !== ticket.id)]);
        } else {
          const next = [{ id: ticket.id, token: accessToken }, ...readStoredTicketAccess().filter((s) => s.id !== ticket.id)];
          writeStoredTicketAccess(next); setStored(next);
          qc.setQueryData(getGetSupportTicketQueryKey(ticket.id), ticket);
        }
        setDescription(''); setSubmitted(false);
      },
      onError: () => setCreateError('We could not create your ticket. Nothing was lost; check your connection and try again.'),
    });
  };

  const ownedList = owned.data ?? [];
  const ownedIds = useMemo(() => new Set(ownedList.map((t) => t.id)), [ownedList]);
  const anon = stored.filter((s) => !ownedIds.has(s.id));
  const forget = (id: string) => { const next = readStoredTicketAccess().filter((s) => s.id !== id); writeStoredTicketAccess(next); setStored(next); };
  const total = ownedList.length + anon.length;
  const issue = getSupportIssue(issueId);

  return (
    <section className="mt-14" aria-labelledby="support-center-heading" data-testid="support-center">
      <div className="relative overflow-hidden border border-border bg-card p-5 sm:p-8">
        <div aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-accent" />
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center bg-accent text-accent-foreground clip-angled-sm"><LifeBuoy aria-hidden className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-accent">Private help desk</p>
            <h2 id="support-center-heading" className="mt-1 font-display text-4xl uppercase leading-none tracking-wide sm:text-5xl">Tell us what went wrong</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Your ticket is saved so we can answer you here and see the whole conversation. Only Pixl Sports administrators can read tickets, and only the ticket. No AI reads or answers them.
            </p>
          </div>
        </div>

        <form onSubmit={submit} noValidate className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_.85fr]" data-testid="form-support-ticket">
          <div className="space-y-5">
            <div>
              <label htmlFor="support-issue" className="mb-2 block text-sm font-bold">What do you need help with?</label>
              <select id="support-issue" value={issueId} onChange={(e) => setIssueId(e.target.value as typeof issueId)} className={field} data-testid="select-support-issue">
                {SUPPORT_ISSUES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="support-description" className="mb-1 block text-sm font-bold">What happened?</label>
              <p id="support-description-help" className="mb-2 text-xs text-muted-foreground">What you expected, what you saw instead. Leave out passwords and sign-in codes.</p>
              <textarea id="support-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={6} maxLength={5000}
                aria-invalid={submitted && Boolean(errors.description)} aria-describedby={`support-description-help${submitted && errors.description ? ' support-description-error' : ''}`}
                className={`${field} py-3 ${submitted && errors.description ? 'border-destructive' : ''}`} data-testid="textarea-support-description" />
              <div className="mt-1 flex justify-between text-xs">
                <p id="support-description-error" role="alert" className="font-semibold text-destructive">{submitted ? errors.description : ''}</p>
                <span className="text-muted-foreground">{description.length}/5000</span>
              </div>
            </div>
            <Segmented legend="What device are you on?" name="device" options={DEVICES} value={deviceType} onChange={(value) => setDeviceType(value as SupportTicketInput['deviceType'])} />
            <Segmented legend="How are you connected?" name="connection" options={CONNECTIONS} value={connectionType} onChange={(value) => setConnectionType(value as SupportTicketInput['connectionType'])} />
            <div>
              <label htmlFor="support-email" className="mb-1 block text-sm font-bold">Reply email</label>
              <p id="support-email-help" className="mb-2 text-xs text-muted-foreground">
                {defaultEmail ? 'Filled from your verified account email. Change it if you want replies elsewhere.' : 'Where we send a copy of each reply.'} Replies also appear in your ticket here.
              </p>
              <input id="support-email" type="email" autoComplete="email" maxLength={254} value={replyEmail}
                onChange={(e) => { emailTouched.current = true; setReplyEmail(e.target.value); }}
                aria-invalid={submitted && Boolean(errors.email)} aria-describedby="support-email-help support-email-error"
                className={`${field} ${submitted && errors.email ? 'border-destructive' : ''}`} data-testid="input-support-reply-email" />
              <p id="support-email-error" role="alert" className="mt-1 text-xs font-semibold text-destructive">{submitted ? errors.email : ''}</p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="border-l-2 border-accent bg-background/40 p-4">
              <h3 className="font-bold">Try these first</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground" data-testid="support-guidance">
                {issue.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </div>
            <div className="border border-border bg-background/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl uppercase">Optional quick checks</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Run on this device only when you ask. The service check is a basic health request with no account data.</p>
                </div>
                <Wifi aria-hidden className="h-5 w-5 text-accent" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2" aria-live="polite" data-testid="support-check-results">
                {([['Connection', diagnostics.connection], ['Storage', diagnostics.browserStorage], ['Service', diagnostics.service]] as const).map(([l, v]) => (
                  <div key={l} className="border border-border p-2"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{l}</p><p className="mt-1 text-xs font-semibold">{diagnosticText(v)}</p></div>
                ))}
              </div>
              {checkMessage && <p className="mt-2 text-xs text-muted-foreground" role="status">{checkMessage}</p>}
              <button type="button" onClick={() => void runChecks()} disabled={checking} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-accent px-4 text-sm font-bold text-accent transition hover:bg-accent hover:text-accent-foreground disabled:opacity-60" data-testid="button-run-support-checks">
                {checking ? 'Checking…' : checksRun ? 'Run checks again' : 'Run quick checks'}
              </button>
              {checksRun && (
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-relaxed">
                  <input type="checkbox" checked={attachChecks} onChange={(e) => setAttachChecks(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]" data-testid="checkbox-attach-checks" />
                  Attach these three results to my ticket
                </label>
              )}
            </div>
            <button type="submit" disabled={create.isPending} aria-busy={create.isPending} className="group inline-flex min-h-12 w-full items-center justify-center gap-2 bg-accent px-6 text-sm font-extrabold uppercase tracking-widest text-accent-foreground transition hover:-translate-y-0.5 disabled:opacity-60 clip-angled-sm" data-testid="button-submit-support-ticket">
              <Send aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-1" />{create.isPending ? 'Creating ticket…' : 'Create ticket'}
            </button>
            <div role="alert" aria-live="assertive" className="text-sm font-semibold text-destructive">
              {createError && <p className="flex items-start gap-2"><AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />{createError}</p>}
              {submitted && (errors.description || errors.email) && !createError && <p>Fix the highlighted fields to continue.</p>}
            </div>
          </div>
        </form>
      </div>

      <div className="mt-8 scroll-mt-6" aria-labelledby="ticket-history-heading" data-testid="section-your-tickets">
        <div className="flex items-end justify-between gap-3">
          <h2 ref={ticketsHeadingRef} id="ticket-history-heading" tabIndex={-1} className="font-display text-3xl uppercase tracking-wide focus:outline-none">Your tickets</h2>
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{total} total</span>
        </div>
        <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {isSignedIn ? 'Tickets on your account appear here, plus any created in this browser while signed out.' : 'Tickets created while signed out stay available on this browser through a private access key. Clearing browser data removes access to them.'}
        </p>
        {isSignedIn && owned.isError && (
          <p className="mt-3 border border-destructive/60 p-3 text-sm" role="alert">Your account tickets could not load. <button type="button" className="font-bold underline" onClick={() => void owned.refetch()}>Try again</button></p>
        )}
        {isSignedIn && owned.isLoading && <div className="mt-4 h-20 animate-pulse border border-border bg-card/50" role="status" aria-label="Loading tickets" />}
        {total === 0 && !owned.isLoading ? (
          <div className="mt-4 grid place-items-center border border-dashed border-border px-4 py-10 text-center">
            <Inbox aria-hidden className="h-8 w-8 text-accent" />
            <p className="mt-2 font-bold">No tickets yet</p>
            <p className="text-sm text-muted-foreground">When you send one, it and every reply will live here.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3" data-testid="list-support-tickets">
            {ownedList.map((t) => <TicketCard key={t.id} id={t.id} preloaded={t} defaultOpen={created?.id === t.id} />)}
            {anon.map((s) => <TicketCard key={s.id} id={s.id} token={s.token} defaultOpen={created?.id === s.id} onForget={() => forget(s.id)} />)}
          </ul>
        )}
      </div>

      <Dialog
        open={confirmationOpen}
        onOpenChange={(open) => {
          setConfirmationOpen(open);
          if (!open) goToTickets();
        }}
      >
        <DialogContent className="border-emerald-400/50 sm:max-w-md" data-testid="dialog-ticket-created">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-3xl uppercase">
              <Check aria-hidden className="h-6 w-6 text-emerald-400" />
              Ticket created
            </DialogTitle>
            <DialogDescription className="text-left leading-relaxed">
              Your support request is saved. You can follow the conversation and see replies in Your tickets.
            </DialogDescription>
          </DialogHeader>
          {created && (
            <p className="border border-border bg-background/50 p-3 text-sm">
              Reference: <span className="font-mono font-bold text-foreground" data-testid="text-ticket-reference">{created.reference}</span>
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">Creating a ticket does not email an administrator; we answer from the help desk queue.</p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setConfirmationOpen(false);
                goToTickets();
              }}
              className="inline-flex min-h-11 w-full items-center justify-center bg-accent px-5 text-sm font-extrabold uppercase tracking-widest text-accent-foreground transition hover:-translate-y-0.5 sm:w-auto"
              data-testid="button-view-your-tickets"
            >
              View your tickets
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
