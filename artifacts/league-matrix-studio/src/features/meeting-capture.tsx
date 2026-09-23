import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
  Download,
  ListChecks,
  MapPin,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useUser } from '@clerk/react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { readScheduleDraft } from '@/features/schedule-draft';
import {
  getMeetingPhase,
  meetingStorageKey,
  readMeetingState,
  type MeetingAgendaItem as AgendaItem,
  type MeetingContext,
  type MeetingDecision as Decision,
  type MeetingFollowUp as FollowUp,
  type MeetingParticipant as Participant,
  type MeetingState,
} from './meeting-capture-model';
import { downloadMeetingRecapPdf } from './meeting-recap-pdf';

const starterParticipants: Participant[] = [
  { id: 'participant-coach', name: 'Coach', role: 'Coach', present: true },
  { id: 'participant-assistant', name: 'Assistant coach', role: 'Staff', present: true },
  { id: 'participant-parent', name: 'Team parent', role: 'Team support', present: false },
];

const starterAgenda: AgendaItem[] = [
  { id: 'agenda-week', label: 'Review the week ahead', completed: false },
  { id: 'agenda-priorities', label: 'Set team priorities', completed: false },
  { id: 'agenda-questions', label: 'Open questions and next steps', completed: false },
];

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankMeetingState(context: MeetingContext): MeetingState {
  return {
    notes: '',
    participants: starterParticipants.map((participant) => ({ ...participant })),
    agenda: starterAgenda.map((item) => ({ ...item })),
    decisions: [{ id: makeId('decision'), text: '' }],
    followUps: [],
    startedAt: null,
    endedAt: null,
    context,
  };
}

function textParam(params: URLSearchParams, ...names: string[]) {
  for (const name of names) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return '';
}

function getMeetingContext(): MeetingContext {
  const params = new URLSearchParams(window.location.search);
  const gameId = textParam(params, 'gameId', 'eventId');
  const eventType = textParam(params, 'eventType');
  const draft = readScheduleDraft(window.localStorage);
  const event = draft?.events.find((candidate) => candidate.id === gameId)
    ?? draft?.events.find((candidate) => candidate.type === 'meeting');
  const queryTitle = textParam(params, 'title', 'meetingTitle', 'eventTitle');
  const eventTitle = event?.opponent?.trim() || '';

  return {
    id: gameId || event?.id || 'meeting-unscheduled',
    date: textParam(params, 'date') || event?.date || '',
    time: textParam(params, 'time') || event?.time || '',
    location: textParam(params, 'location') || event?.location || '',
    title: queryTitle || eventTitle || (eventType === 'meeting' ? 'Team meeting' : 'Team meeting'),
  };
}

function formatDate(value: string) {
  if (!value) return 'Date to be confirmed';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(value: string) {
  if (!value) return 'Time to be confirmed';
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatEndedAt(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function recapText(context: MeetingContext, state: MeetingState) {
  const present = state.participants.filter((participant) => participant.present);
  const absent = state.participants.filter((participant) => !participant.present);
  const agenda = state.agenda.filter((item) => item.label.trim());
  const decisions = state.decisions.filter((decision) => decision.text.trim());
  const followUps = state.followUps.filter((followUp) => followUp.task.trim());
  const lines = [
    `PIXL SPORTS / ${context.title.toUpperCase()}`,
    `${formatDate(context.date)} · ${formatTime(context.time)} · ${context.location || 'Location to be confirmed'}`,
    '',
    'ATTENDANCE',
    present.length ? `Present: ${present.map((participant) => participant.name).join(', ')}` : 'Present: None recorded',
    absent.length ? `Absent: ${absent.map((participant) => participant.name).join(', ')}` : 'Absent: None recorded',
    '',
    'AGENDA',
    ...(agenda.length ? agenda.map((item) => `${item.completed ? '[x]' : '[ ]'} ${item.label}`) : ['No agenda items recorded']),
    '',
    'NOTES',
    state.notes.trim() || 'No live notes recorded.',
    '',
    'DECISIONS',
    ...(decisions.length ? decisions.map((decision) => `- ${decision.text}`) : ['No decisions recorded']),
    '',
    'FOLLOW-UPS',
    ...(followUps.length
      ? followUps.map((followUp) => `- ${followUp.task}${followUp.owner ? ` / Owner: ${followUp.owner}` : ''}${followUp.dueDate ? ` / Due: ${followUp.dueDate}` : ''}`)
      : ['No follow-ups recorded']),
  ];
  return lines.join('\n');
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#8fb9d8]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#e8a45c]" aria-hidden="true" />
      {children}
    </p>
  );
}

function MeetingHeader({
  context,
  ended,
  recap,
  prep = false,
  onBack,
}: {
  context: MeetingContext;
  ended: boolean;
  recap: boolean;
  prep?: boolean;
  onBack: () => void;
}) {
  return (
    <header className="border-b border-white/10 bg-[#102b4d]/90 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 -mx-2 items-center gap-2 px-2 text-xs font-bold uppercase tracking-[0.15em] text-[#9ebbd1] touch-manipulation transition-colors hover:text-[#f7c97a]"
            data-testid="button-back-to-dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </button>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6e94b2]" data-testid="text-meeting-mode">
            <span className={`h-2 w-2 rounded-full ${ended ? 'bg-[#8b9aad]' : 'animate-pulse bg-[#f7c97a]'}`} />
            {recap ? 'Recap' : ended ? 'Meeting ended' : prep ? 'Prep' : 'Live capture'}
          </div>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <SectionLabel>Sideline notebook</SectionLabel>
            <h1 className="mt-3 max-w-3xl font-display text-5xl uppercase leading-[0.86] tracking-tight text-[#f6f2e9] sm:text-7xl" data-testid="text-meeting-title">
              {context.title}
            </h1>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#a5bfd2]">
              <span className="inline-flex items-center gap-2" data-testid="text-meeting-date"><CalendarDays className="h-4 w-4 text-[#f7c97a]" />{formatDate(context.date)}</span>
              <span className="inline-flex items-center gap-2" data-testid="text-meeting-time"><Clock3 className="h-4 w-4 text-[#f7c97a]" />{formatTime(context.time)}</span>
              <span className="inline-flex items-center gap-2" data-testid="text-meeting-location"><MapPin className="h-4 w-4 text-[#f7c97a]" />{context.location || 'Location to be confirmed'}</span>
            </div>
          </div>
          <div className="border-l-2 border-[#e8a45c] pl-4 text-sm text-[#c3d4df] lg:max-w-[230px]" data-testid="text-meeting-prompt">
            Keep the room moving. Capture what matters while it is still fresh.
          </div>
        </div>
      </div>
    </header>
  );
}

export function MeetingCapture() {
  const { user } = useUser();
  const context = useMemo(() => getMeetingContext(), []);
  const storageKey = meetingStorageKey(user?.id || 'guest', context.id);
  const requestedView = useMemo(() => new URLSearchParams(window.location.search).get('view'), []);
  const [state, setState] = useState<MeetingState>(() => readMeetingState(window.localStorage, storageKey) ?? blankMeetingState(context));
  const [loadedKey, setLoadedKey] = useState(storageKey);
  const [showRecap, setShowRecap] = useState(() => requestedView === 'share' || requestedView === 'review');
  const [editingEnded, setEditingEnded] = useState(false);
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeRole, setAttendeeRole] = useState('');
  const [agendaDraft, setAgendaDraft] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [pdfStatus, setPdfStatus] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    if (storageKey === loadedKey) return;
    const restored = readMeetingState(window.localStorage, storageKey);
    const guestKey = meetingStorageKey('guest', context.id);
    const guestState = restored ? null : readMeetingState(window.localStorage, guestKey);
    setState(restored ?? guestState ?? blankMeetingState(context));
    if (!restored && guestState && storageKey !== guestKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(guestState));
      } catch {
        // The meeting remains usable if browser storage is unavailable.
      }
    }
    setLoadedKey(storageKey);
    setShowRecap(requestedView === 'share' || requestedView === 'review');
    setEditingEnded(false);
  }, [context, loadedKey, requestedView, storageKey]);

  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // The meeting remains usable if browser storage is unavailable.
    }
  }, [loadedKey, state, storageKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(new Date()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (state.context?.id === context.id) return;
    setState((current) => ({ ...current, context }));
  }, [context, state.context?.id]);

  const completedAgenda = state.agenda.filter((item) => item.completed).length;
  const presentCount = state.participants.filter((participant) => participant.present).length;
  const agendaProgress = state.agenda.length ? Math.round((completedAgenda / state.agenda.length) * 100) : 0;
  const ended = Boolean(state.endedAt);
  const phase = getMeetingPhase(context, state, currentTime);

  const updateState = (patch: Partial<MeetingState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // The meeting remains usable if browser storage is unavailable.
      }
      return next;
    });
  };

  const toggleParticipant = (id: string) => {
    updateState({
      participants: state.participants.map((participant) => (
        participant.id === id ? { ...participant, present: !participant.present } : participant
      )),
    });
  };

  const updateParticipant = (id: string, patch: Partial<Participant>) => {
    updateState({
      participants: state.participants.map((participant) => (
        participant.id === id ? { ...participant, ...patch } : participant
      )),
    });
  };

  const addAttendee = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = attendeeName.trim();
    if (!name) return;
    updateState({
      participants: [
        ...state.participants,
        { id: makeId('participant'), name, role: attendeeRole.trim() || 'Attendee', present: true },
      ],
    });
    setAttendeeName('');
    setAttendeeRole('');
  };

  const addAgendaItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = agendaDraft.trim();
    if (!label) return;
    updateState({ agenda: [...state.agenda, { id: makeId('agenda'), label, completed: false }] });
    setAgendaDraft('');
  };

  const updateAgendaItem = (id: string, label: string) => {
    updateState({ agenda: state.agenda.map((item) => item.id === id ? { ...item, label } : item) });
  };

  const toggleAgenda = (id: string) => {
    updateState({
      agenda: state.agenda.map((item) => item.id === id ? { ...item, completed: !item.completed } : item),
    });
  };

  const addDecision = () => {
    updateState({ decisions: [...state.decisions, { id: makeId('decision'), text: '' }] });
  };

  const addFollowUp = () => {
    updateState({ followUps: [...state.followUps, { id: makeId('follow-up'), task: '', owner: '', dueDate: '' }] });
  };

  const handleEndMeeting = () => {
    updateState({
      startedAt: state.startedAt ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
    setCopyStatus('');
    setShareStatus('');
    setEditingEnded(false);
    setShowRecap(true);
  };

  const handleCopy = async () => {
    const text = recapText(context, state);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopyStatus('Recap copied to your clipboard.');
    } catch {
      setCopyStatus('Copy was not available. Select the recap text to copy it manually.');
    }
  };

  const handleShare = async () => {
    if (!navigator.share) {
      setShareStatus('Web Share is not available on this device. Copy the recap instead.');
      return;
    }
    try {
      await navigator.share({ title: `Pixl Sports recap: ${context.title}`, text: recapText(context, state) });
      setShareStatus('Recap shared.');
    } catch {
      setShareStatus('Share was cancelled or could not be completed.');
    }
  };

  const handleDownloadPdf = () => {
    try {
      downloadMeetingRecapPdf(context, state);
      setPdfStatus('PDF downloaded.');
    } catch {
      setPdfStatus('PDF could not be created on this device. Copy the recap instead.');
    }
  };

  const handleBack = () => {
    // Preserve the artifact base path while returning to the studio dashboard.
    window.location.assign(
      `${window.location.pathname.replace(/\/studio\/checklist$/, '/studio')}${window.location.hash}`,
    );
  };

  const showRecapView = ended && (showRecap || (phase === 'share' && !editingEnded));

  if (showRecapView) {
    return (
      <div className="min-h-dvh bg-[#0b2039] text-[#f6f2e9]">
        <MeetingHeader context={context} ended={ended} recap onBack={handleBack} />
        <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <SectionLabel>Ready to send</SectionLabel>
              <h2 className="mt-3 font-display text-4xl uppercase leading-none sm:text-6xl" data-testid="text-recap-heading">Meeting recap</h2>
              <p className="mt-3 text-sm text-[#9ebbd1]" data-testid="text-recap-ended-at">
                Ended {formatEndedAt(state.endedAt) || 'just now'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowRecap(false);
                setEditingEnded(true);
              }}
              className="inline-flex items-center gap-2 border border-[#426481] bg-[#163858] px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-[#f6f2e9] transition-colors hover:border-[#f7c97a] hover:text-[#f7c97a]"
              data-testid="button-return-to-editing"
            >
              <RotateCcw className="h-4 w-4" />
              Return to editing
            </button>
          </div>
          <div className="mt-8 border border-[#426481] bg-[#102b4d] shadow-[10px_10px_0_rgba(232,164,92,0.18)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-7">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#f7c97a]"><CheckCircle2 className="h-4 w-4" /> Clean handoff</span>
              <span className="text-xs text-[#8aa9c1]" data-testid="text-recap-stats">{presentCount} present · {completedAgenda} of {state.agenda.length} agenda items complete</span>
            </div>
            <pre className="whitespace-pre-wrap px-5 py-6 font-sans text-sm leading-7 text-[#edf2f1] sm:px-7 sm:py-8" data-testid="text-recap-content">{recapText(context, state)}</pre>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={handleCopy} className="inline-flex items-center justify-center gap-2 bg-[#e8a45c] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#18263a] transition-transform hover:-translate-y-0.5" data-testid="button-copy-recap">
              <Copy className="h-4 w-4" /> Copy recap
            </button>
            <button type="button" onClick={handleDownloadPdf} className="inline-flex items-center justify-center gap-2 border border-[#e8a45c] bg-[#102b4d] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#f7c97a] transition-colors hover:bg-[#e8a45c] hover:text-[#18263a]" data-testid="button-download-recap-pdf">
              <Download className="h-4 w-4" /> Download PDF
            </button>
            <button type="button" onClick={handleShare} className="inline-flex items-center justify-center gap-2 border border-[#6385a0] bg-[#163858] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#f6f2e9] transition-colors hover:border-[#f7c97a] hover:text-[#f7c97a]" data-testid="button-share-recap">
              <Send className="h-4 w-4" /> Share recap
            </button>
          </div>
          <div className="mt-4 min-h-6 space-y-1 text-sm text-[#f7c97a]" aria-live="polite" data-testid="status-recap-actions">
            {copyStatus && <p data-testid="status-copy-recap">{copyStatus}</p>}
            {pdfStatus && <p data-testid="status-download-recap-pdf">{pdfStatus}</p>}
            {shareStatus && <p data-testid="status-share-recap">{shareStatus}</p>}
          </div>
        </main>
      </div>
    );
  }

  if (phase === 'prep') {
    return (
      <div className="min-h-dvh bg-[#0b2039] text-[#f6f2e9]">
        <MeetingHeader context={context} ended={false} recap={false} prep onBack={handleBack} />
        <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 sm:py-10">
          <div className="mb-8 border-b border-white/10 pb-6">
            <SectionLabel>Before the room</SectionLabel>
            <h2 className="mt-3 font-display text-4xl uppercase leading-none sm:text-6xl" data-testid="text-meeting-prep-heading">Meeting prep</h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#aec5d3]" data-testid="text-meeting-prep-description">
              Set the agenda and who should be in the room. Live notes and follow-ups will appear when the meeting starts.
            </p>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-[#6f95b2]" data-testid="text-meeting-prep-save-status">
              Saved locally to this team workspace
            </p>
          </div>

          <div className="grid gap-5">
            <section className="border border-[#426481] bg-[#102b4d] p-5 sm:p-7" aria-labelledby="prep-agenda-heading">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <SectionLabel>Set the plan</SectionLabel>
                  <h2 id="prep-agenda-heading" className="mt-3 font-display text-3xl uppercase leading-none">Agenda</h2>
                </div>
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8aa9c1]">Editable</span>
              </div>
              <div className="mt-5 space-y-2">
                {state.agenda.map((item) => (
                  <div key={item.id} className="border-b border-white/10 py-2" data-testid={`row-prep-agenda-${item.id}`}>
                    <label htmlFor={`prep-agenda-${item.id}`} className="sr-only">Agenda item {item.id}</label>
                    <input
                      id={`prep-agenda-${item.id}`}
                      aria-label={`Agenda item ${item.id}`}
                      value={item.label}
                      onChange={(event) => updateAgendaItem(item.id, event.target.value)}
                      className="w-full bg-transparent py-1 text-sm text-[#f6f2e9] outline-none focus:border-b focus:border-[#f7c97a]"
                      data-testid={`input-prep-agenda-${item.id}`}
                    />
                  </div>
                ))}
              </div>
              <form onSubmit={addAgendaItem} className="mt-4 flex gap-2">
                <label htmlFor="prep-new-agenda-item" className="sr-only">New agenda item</label>
                <input id="prep-new-agenda-item" value={agendaDraft} onChange={(event) => setAgendaDraft(event.target.value)} placeholder="Add an agenda item" className="min-w-0 flex-1 border border-[#41627e] bg-[#0c2643] px-3 py-2.5 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid="input-prep-new-agenda" />
                <button type="submit" className="grid min-h-11 w-11 shrink-0 place-items-center bg-[#e8a45c] text-[#18263a]" aria-label="Add agenda item" data-testid="button-prep-add-agenda"><Plus className="h-5 w-5" /></button>
              </form>
            </section>

            <section className="border border-[#426481] bg-[#163858] p-5 sm:p-7" aria-labelledby="prep-attendance-heading">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <SectionLabel>Invite the room</SectionLabel>
                  <h2 id="prep-attendance-heading" className="mt-3 font-display text-3xl uppercase leading-none">Attendees</h2>
                </div>
                <span className="text-sm text-[#f7c97a]" data-testid="text-prep-attendance-count">{presentCount} expected</span>
              </div>
              <div className="mt-4 space-y-2">
                {state.participants.map((participant) => (
                  <div key={participant.id} className="flex items-center gap-2 border-b border-white/10 py-2" data-testid={`row-prep-participant-${participant.id}`}>
                    <button type="button" onClick={() => toggleParticipant(participant.id)} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors ${participant.present ? 'border-[#e8a45c] bg-[#e8a45c] text-[#18263a]' : 'border-[#6385a0] text-[#6385a0]'}`} aria-label={`${participant.present ? 'Mark absent' : 'Mark expected'}: ${participant.name}`} aria-pressed={participant.present} data-testid={`button-prep-toggle-participant-${participant.id}`}>
                      {participant.present ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </button>
                    <input aria-label={`Attendee name ${participant.id}`} value={participant.name} onChange={(event) => updateParticipant(participant.id, { name: event.target.value })} className="min-w-0 flex-1 bg-transparent py-1 text-sm text-[#f6f2e9] outline-none focus:border-b focus:border-[#f7c97a]" data-testid={`input-prep-participant-name-${participant.id}`} />
                    <input aria-label={`Attendee role ${participant.id}`} value={participant.role} onChange={(event) => updateParticipant(participant.id, { role: event.target.value })} className="hidden w-28 bg-transparent py-1 text-right text-xs text-[#8faec2] outline-none focus:border-b focus:border-[#f7c97a] sm:block" data-testid={`input-prep-participant-role-${participant.id}`} />
                  </div>
                ))}
              </div>
              <form onSubmit={addAttendee} className="mt-4 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                <label htmlFor="prep-new-attendee-name" className="sr-only">Attendee name</label>
                <input id="prep-new-attendee-name" value={attendeeName} onChange={(event) => setAttendeeName(event.target.value)} placeholder="Add attendee" className="border border-[#41627e] bg-[#0c2643] px-3 py-2.5 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid="input-prep-new-attendee" />
                <label htmlFor="prep-new-attendee-role" className="sr-only">Attendee role</label>
                <input id="prep-new-attendee-role" value={attendeeRole} onChange={(event) => setAttendeeRole(event.target.value)} placeholder="Role" className="border border-[#41627e] bg-[#0c2643] px-3 py-2.5 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid="input-prep-new-attendee-role" />
                <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#6385a0] px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#f6f2e9] hover:border-[#f7c97a] hover:text-[#f7c97a]" data-testid="button-prep-add-attendee"><Plus className="h-4 w-4" /> Add</button>
              </form>
            </section>
          </div>
          <p className="mt-6 text-center text-xs font-bold uppercase tracking-[0.16em] text-[#6f95b2]" data-testid="text-meeting-prep-boundary">
            Live capture opens at the scheduled meeting time.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0b2039] text-[#f6f2e9]">
      <MeetingHeader context={context} ended={ended} recap={false} onBack={handleBack} />
      <main className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-sm text-[#aec5d3]" data-testid="text-meeting-status">
              {ended ? `Meeting ended ${formatEndedAt(state.endedAt)}` : 'Capture the conversation as it happens.'}
            </p>
            <p className="mt-1 text-xs text-[#6f95b2]" data-testid="text-local-save-status">Saved locally to this team workspace</p>
          </div>
          {ended ? (
            <button type="button" onClick={() => setShowRecap(true)} className="inline-flex items-center gap-2 bg-[#e8a45c] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#18263a] transition-transform hover:-translate-y-0.5" data-testid="button-review-recap">
              <Clipboard className="h-4 w-4" /> Review recap
            </button>
          ) : (
            <button type="button" onClick={handleEndMeeting} className="inline-flex items-center gap-2 border border-[#e8a45c]/70 bg-[#293e52] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#f7c97a] transition-colors hover:bg-[#e8a45c] hover:text-[#18263a]" data-testid="button-end-meeting">
              <CheckCircle2 className="h-4 w-4" /> End meeting
            </button>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(300px,.92fr)]">
          <section className="border border-[#426481] bg-[#102b4d] p-5 shadow-[8px_8px_0_rgba(26,54,80,0.7)] sm:p-7" aria-labelledby="notes-heading">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionLabel>Live capture</SectionLabel>
                <h2 id="notes-heading" className="mt-3 font-display text-4xl uppercase leading-none sm:text-5xl">Notes in the room</h2>
              </div>
              <MessageSquare className="h-7 w-7 text-[#f7c97a]" aria-hidden="true" />
            </div>
            <label htmlFor="meeting-notes" className="sr-only">Live meeting notes</label>
            <textarea
              id="meeting-notes"
              value={state.notes}
              onChange={(event) => updateState({ notes: event.target.value })}
              placeholder="Write the useful bits. Rough is fine."
              className="mt-7 min-h-[280px] w-full resize-y border border-[#41627e] bg-[#0c2643] p-4 text-base leading-7 text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none transition-colors focus:border-[#f7c97a] sm:min-h-[350px]"
              data-testid="textarea-meeting-notes"
            />
            <div className="mt-3 flex items-center justify-between text-xs text-[#789ab2]">
              <span>Notes save as you type.</span>
              <span data-testid="text-notes-count">{state.notes.length} characters</span>
            </div>
          </section>

          <div className="grid gap-5">
            <section className="border border-[#426481] bg-[#102b4d] p-5 sm:p-6" aria-labelledby="agenda-heading">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <SectionLabel>Keep it moving</SectionLabel>
                  <h2 id="agenda-heading" className="mt-3 font-display text-3xl uppercase leading-none">Agenda</h2>
                </div>
                <span className="font-mono text-sm text-[#f7c97a]" data-testid="text-agenda-progress">{completedAgenda}/{state.agenda.length}</span>
              </div>
              <div className="mt-5 h-1.5 overflow-hidden bg-[#0c2643]" aria-label={`${agendaProgress}% of agenda complete`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={agendaProgress} data-testid="progress-agenda">
                <div className="h-full bg-[#e8a45c] transition-[width] duration-300" style={{ width: `${agendaProgress}%` }} />
              </div>
              <div className="mt-4 space-y-2">
                {state.agenda.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 border-b border-white/10 py-2" data-testid={`row-agenda-${item.id}`}>
                    <button type="button" onClick={() => toggleAgenda(item.id)} className={`grid h-6 w-6 shrink-0 place-items-center border transition-colors ${item.completed ? 'border-[#e8a45c] bg-[#e8a45c] text-[#18263a]' : 'border-[#6385a0] text-transparent hover:border-[#f7c97a]'}`} aria-label={`${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${item.label}`} aria-pressed={item.completed} data-testid={`button-toggle-agenda-${item.id}`}>
                      <Check className="h-4 w-4" />
                    </button>
                    <input aria-label={`Agenda item ${item.id}`} value={item.label} onChange={(event) => updateAgendaItem(item.id, event.target.value)} className={`min-w-0 flex-1 bg-transparent py-1 text-sm outline-none ${item.completed ? 'text-[#8fa7b9] line-through' : 'text-[#f6f2e9]'}`} data-testid={`input-agenda-${item.id}`} />
                  </div>
                ))}
              </div>
              <form onSubmit={addAgendaItem} className="mt-4 flex gap-2">
                <label htmlFor="new-agenda-item" className="sr-only">New agenda item</label>
                <input id="new-agenda-item" value={agendaDraft} onChange={(event) => setAgendaDraft(event.target.value)} placeholder="Add an agenda item" className="min-w-0 flex-1 border border-[#41627e] bg-[#0c2643] px-3 py-2.5 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid="input-new-agenda" />
                <button type="submit" className="grid w-11 shrink-0 place-items-center bg-[#e8a45c] text-[#18263a] transition-transform hover:-translate-y-0.5" aria-label="Add agenda item" data-testid="button-add-agenda"><Plus className="h-5 w-5" /></button>
              </form>
            </section>

            <section className="border border-[#426481] bg-[#163858] p-5 sm:p-6" aria-labelledby="attendance-heading">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <SectionLabel>Who is here</SectionLabel>
                  <h2 id="attendance-heading" className="mt-3 font-display text-3xl uppercase leading-none">Attendance</h2>
                </div>
                <span className="text-sm text-[#f7c97a]" data-testid="text-attendance-count">{presentCount} present</span>
              </div>
              <div className="mt-4 space-y-2">
                {state.participants.map((participant) => (
                  <div key={participant.id} className="flex items-center gap-2 border-b border-white/10 py-2" data-testid={`row-participant-${participant.id}`}>
                    <button type="button" onClick={() => toggleParticipant(participant.id)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors ${participant.present ? 'border-[#e8a45c] bg-[#e8a45c] text-[#18263a]' : 'border-[#6385a0] text-transparent hover:border-[#f7c97a]'}`} aria-label={`${participant.present ? 'Mark absent' : 'Mark present'}: ${participant.name}`} aria-pressed={participant.present} data-testid={`button-toggle-participant-${participant.id}`}>
                      {participant.present ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </button>
                    <input aria-label={`Attendee name ${participant.id}`} value={participant.name} onChange={(event) => updateParticipant(participant.id, { name: event.target.value })} className="min-w-0 flex-1 bg-transparent py-1 text-sm text-[#f6f2e9] outline-none focus:border-b focus:border-[#f7c97a]" data-testid={`input-participant-name-${participant.id}`} />
                    <input aria-label={`Attendee role ${participant.id}`} value={participant.role} onChange={(event) => updateParticipant(participant.id, { role: event.target.value })} className="hidden w-24 bg-transparent py-1 text-right text-xs text-[#8faec2] outline-none focus:border-b focus:border-[#f7c97a] sm:block" data-testid={`input-participant-role-${participant.id}`} />
                  </div>
                ))}
              </div>
              <form onSubmit={addAttendee} className="mt-4 grid gap-2 sm:grid-cols-[1fr_100px_auto]">
                <label htmlFor="new-attendee-name" className="sr-only">Attendee name</label>
                <input id="new-attendee-name" value={attendeeName} onChange={(event) => setAttendeeName(event.target.value)} placeholder="Add attendee" className="border border-[#41627e] bg-[#0c2643] px-3 py-2.5 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid="input-new-attendee" />
                <label htmlFor="new-attendee-role" className="sr-only">Attendee role</label>
                <input id="new-attendee-role" value={attendeeRole} onChange={(event) => setAttendeeRole(event.target.value)} placeholder="Role" className="border border-[#41627e] bg-[#0c2643] px-3 py-2.5 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid="input-new-attendee-role" />
                <button type="submit" className="inline-flex items-center justify-center gap-2 border border-[#6385a0] px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#f6f2e9] hover:border-[#f7c97a] hover:text-[#f7c97a]" data-testid="button-add-attendee"><Plus className="h-4 w-4" /> Add</button>
              </form>
            </section>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section className="border border-[#426481] bg-[#102b4d] p-5 sm:p-7" aria-labelledby="decisions-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionLabel>Make it clear</SectionLabel>
                <h2 id="decisions-heading" className="mt-3 font-display text-3xl uppercase leading-none">Decisions</h2>
              </div>
              <ListChecks className="h-6 w-6 text-[#f7c97a]" aria-hidden="true" />
            </div>
            <div className="mt-5 space-y-3">
              {state.decisions.map((decision, index) => (
                <div key={decision.id} className="flex items-start gap-3" data-testid={`row-decision-${decision.id}`}>
                  <span className="pt-2 font-mono text-xs text-[#e8a45c]">{String(index + 1).padStart(2, '0')}</span>
                  <textarea aria-label={`Decision ${index + 1}`} value={decision.text} onChange={(event) => updateState({ decisions: state.decisions.map((item) => item.id === decision.id ? { ...item, text: event.target.value } : item) })} placeholder="What did the room decide?" rows={2} className="min-h-[58px] flex-1 resize-y border border-[#41627e] bg-[#0c2643] px-3 py-2.5 text-sm leading-6 text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid={`textarea-decision-${decision.id}`} />
                  {state.decisions.length > 1 && <button type="button" onClick={() => updateState({ decisions: state.decisions.filter((item) => item.id !== decision.id) })} className="mt-2 text-[#789ab2] hover:text-[#f08e73]" aria-label={`Remove decision ${index + 1}`} data-testid={`button-remove-decision-${decision.id}`}><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
            <button type="button" onClick={addDecision} className="mt-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#f7c97a] hover:text-[#ffe0a8]" data-testid="button-add-decision"><Plus className="h-4 w-4" /> Add decision</button>
          </section>

          <section className="border border-[#426481] bg-[#163858] p-5 sm:p-7" aria-labelledby="follow-ups-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionLabel>Keep the promise</SectionLabel>
                <h2 id="follow-ups-heading" className="mt-3 font-display text-3xl uppercase leading-none">Follow-ups</h2>
              </div>
              <UsersRound className="h-6 w-6 text-[#f7c97a]" aria-hidden="true" />
            </div>
            <div className="mt-5 space-y-4">
              {state.followUps.length === 0 && <p className="border border-dashed border-[#41627e] px-4 py-5 text-sm text-[#88a8bc]" data-testid="text-follow-ups-empty">No follow-ups yet. Add the actions that should leave the room.</p>}
              {state.followUps.map((followUp, index) => (
                <div key={followUp.id} className="relative border border-[#41627e] bg-[#0c2643] p-3" data-testid={`row-follow-up-${followUp.id}`}>
                  <button type="button" onClick={() => updateState({ followUps: state.followUps.filter((item) => item.id !== followUp.id) })} className="absolute right-3 top-3 text-[#789ab2] hover:text-[#f08e73]" aria-label={`Remove follow-up ${index + 1}`} data-testid={`button-remove-follow-up-${followUp.id}`}><Trash2 className="h-4 w-4" /></button>
                  <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
                    <div>
                      <label htmlFor={`follow-up-task-${followUp.id}`} className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#789ab2]">Task</label>
                      <input id={`follow-up-task-${followUp.id}`} value={followUp.task} onChange={(event) => updateState({ followUps: state.followUps.map((item) => item.id === followUp.id ? { ...item, task: event.target.value } : item) })} placeholder="Action to take" className="mt-1 w-full border-b border-[#41627e] bg-transparent py-1 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid={`input-follow-up-task-${followUp.id}`} />
                    </div>
                    <div>
                      <label htmlFor={`follow-up-due-${followUp.id}`} className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#789ab2]">Due</label>
                      <input id={`follow-up-due-${followUp.id}`} type="date" value={followUp.dueDate} onChange={(event) => updateState({ followUps: state.followUps.map((item) => item.id === followUp.id ? { ...item, dueDate: event.target.value } : item) })} className="mt-1 w-full border-b border-[#41627e] bg-transparent py-1 text-sm text-[#f6f2e9] outline-none focus:border-[#f7c97a]" data-testid={`input-follow-up-due-${followUp.id}`} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-[#789ab2]" aria-hidden="true" />
                    <label htmlFor={`follow-up-owner-${followUp.id}`} className="sr-only">Owner</label>
                    <input id={`follow-up-owner-${followUp.id}`} value={followUp.owner} onChange={(event) => updateState({ followUps: state.followUps.map((item) => item.id === followUp.id ? { ...item, owner: event.target.value } : item) })} placeholder="Owner" className="min-w-0 flex-1 border-b border-[#41627e] bg-transparent py-1 text-sm text-[#f6f2e9] placeholder:text-[#6d91ad] outline-none focus:border-[#f7c97a]" data-testid={`input-follow-up-owner-${followUp.id}`} />
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addFollowUp} className="mt-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#f7c97a] hover:text-[#ffe0a8]" data-testid="button-add-follow-up"><Plus className="h-4 w-4" /> Add follow-up</button>
          </section>
        </div>
      </main>
    </div>
  );
}

export default MeetingCapture;