import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Check, ChevronDown, CircleStop, Clock3, FileText, History, Loader2, Minus, Plus, RotateCcw, Save, Trophy } from 'lucide-react';
import { useUser } from '@clerk/react';
import {
  useCreateProject,
  useGetAccountAccess,
  useGetConnectedCoachCalendar,
  useGetConnectedCoachCalendarBySubscription,
  useListProjects,
  useUpdateProject,
  getGetAccountAccessQueryKey,
  getListProjectsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

import {
  getCalendarConnectionErrorKind,
  getStoredCalendarConnection,
} from './calendar-connection';
import { getGuestUsageKey } from './guest-access';
import { getUserProfile } from './supporter-dashboard-model';
import { readScheduleDraft } from './schedule-draft';
import {
  addStatEvent,
  adjustScore,
  createGameSession,
  endGame,
  getSportRule,
  isSport,
  isTrackerRevisionConflict,
  mergeTrackerData,
  normalizeTrackerData,
  seasonTotals,
  sports,
  trackerSaveErrorMessage,
  undoLastStatEvent,
  type GameSession,
  type Sport,
  type StatTrackerData,
} from './stat-tracker';

const localStorageKey = 'leaguematrix-stat-tracker';
const activeGameStorageKey = 'leaguematrix-stat-tracker-active-game';

function trackerPayload(data: StatTrackerData) {
  return { ...data, tool: 'stat-tracker' };
}

function readLocalTracker(): StatTrackerData {
  try {
    return normalizeTrackerData(JSON.parse(window.localStorage.getItem(localStorageKey) ?? '{}'));
  } catch {
    return normalizeTrackerData(null);
  }
}

function saveLocalTracker(data: StatTrackerData) {
  window.localStorage.setItem(localStorageKey, JSON.stringify(data));
}

function readLocalActiveGame(): GameSession | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(activeGameStorageKey) ?? 'null');
    return value && typeof value === 'object' && isSport(value.sport) ? value as GameSession : null;
  } catch {
    return null;
  }
}

type ScheduledGame = {
  type: string;
  date: string;
  time: string;
  opponent: string;
};

function getNextScheduledGame(events: readonly ScheduledGame[] = (readScheduleDraft()?.events ?? [])) {
  const today = new Date().toISOString().slice(0, 10);
  return [...events]
    .filter((event) => event.type === 'game' && event.date >= today)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0];
}

function formatDate(value: string) {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function StatTrackerPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded, isSignedIn } = useUser();
  const queryClient = useQueryClient();
  const profile = getUserProfile(user);
  const localNextGame = useMemo(() => getNextScheduledGame(), []);
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const calendarConnection = useMemo(() => getStoredCalendarConnection(), []);
  const calendarCode = calendarConnection?.kind === 'code' ? calendarConnection.value : '';
  const calendarSubscriptionToken = calendarConnection?.kind === 'subscription' ? calendarConnection.value : '';
  const codeCalendarQuery = useGetConnectedCoachCalendar(calendarCode, {
    query: {
      enabled: Boolean(isSignedIn && calendarCode),
      refetchInterval: (query) => getCalendarConnectionErrorKind(query.state.error) === 'invalid' ? false : 30000,
      refetchOnWindowFocus: (query) => getCalendarConnectionErrorKind(query.state.error) !== 'invalid',
      queryKey: ['/api/coach-calendar', calendarCode],
    },
  });
  const subscriptionCalendarQuery = useGetConnectedCoachCalendarBySubscription(calendarSubscriptionToken, {
    query: {
      enabled: Boolean(isSignedIn && calendarSubscriptionToken),
      refetchInterval: (query) => getCalendarConnectionErrorKind(query.state.error) === 'invalid' ? false : 30000,
      refetchOnWindowFocus: (query) => getCalendarConnectionErrorKind(query.state.error) !== 'invalid',
      queryKey: ['/api/coach-calendar/subscription', calendarSubscriptionToken],
    },
  });
  const activeCalendarQuery = calendarConnection?.kind === 'subscription'
    ? subscriptionCalendarQuery
    : codeCalendarQuery;
  const connectedCalendar = activeCalendarQuery.data;
  const connectedNextGame = useMemo(
    () => getNextScheduledGame(connectedCalendar?.events),
    [connectedCalendar?.events],
  );
  const [sport, setSport] = useState<Sport>(profile.sport ?? 'basketball');
  const [data, setData] = useState<StatTrackerData>(() => readLocalTracker());
  const [currentGame, setCurrentGame] = useState<GameSession | null>(() => readLocalActiveGame());
  const [date, setDate] = useState(searchParams.get('date') ?? localNextGame?.date ?? new Date().toISOString().slice(0, 10));
  const [opponent, setOpponent] = useState(searchParams.get('opponent') ?? localNextGame?.opponent ?? '');
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [showAllStats, setShowAllStats] = useState(false);
  const [cloudProject, setCloudProject] = useState<{ id: string; revision: number } | null>(null);
  const initializedCloud = useRef(false);
  const manuallyEditedSetup = useRef({
    date: searchParams.has('date'),
    opponent: searchParams.has('opponent'),
  });
  const connectedPrefillApplied = useRef(false);
  const guestUsageKey = useRef(getGuestUsageKey('lineup', 'stat-tracker')).current;
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const { data: accountAccess } = useGetAccountAccess({
    query: { enabled: Boolean(isSignedIn), staleTime: 15000, queryKey: getGetAccountAccessQueryKey() },
  });
  const { data: projects } = useListProjects({
    query: { enabled: Boolean(isSignedIn && accountAccess), queryKey: getListProjectsQueryKey() },
  });

  useEffect(() => {
    const existing = (projects ?? [])
      .filter((project) => project.project.tool === 'stat-tracker')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!existing || initializedCloud.current) return;
    initializedCloud.current = true;
    const mergedData = mergeTrackerData(readLocalTracker(), existing.project);
    setData(mergedData);
    setCloudProject({ id: existing.id, revision: existing.revision });
    saveLocalTracker(mergedData);
  }, [projects]);

  useEffect(() => {
    saveLocalTracker(data);
  }, [data]);

  useEffect(() => {
    if (currentGame) window.localStorage.setItem(activeGameStorageKey, JSON.stringify(currentGame));
    else window.localStorage.removeItem(activeGameStorageKey);
  }, [currentGame]);

  useEffect(() => {
    if (!connectedNextGame || connectedPrefillApplied.current) return;
    connectedPrefillApplied.current = true;
    if (!manuallyEditedSetup.current.date) setDate(connectedNextGame.date);
    if (!manuallyEditedSetup.current.opponent) setOpponent(connectedNextGame.opponent);
  }, [connectedNextGame]);

  const rule = getSportRule(sport);
  const totals = seasonTotals(data.games, sport);
  const displayStats = rule.stats.filter((item) => showAllStats || item.featured);
  const nextGame = connectedNextGame ?? localNextGame;
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };

  if (!isLoaded) return <div className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground">Loading tracker…</div>;
  if (!isSignedIn) {
    setLocation('/sign-in?redirect_url=%2Fstudio%2Fstat-tracker');
    return null;
  }

  const beginGame = () => {
    setError('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    setCurrentGame(createGameSession(sport, { date, opponent, notes }));
    announce('GAME STARTED — LIVE STATS ARE READY');
  };

  const updateCurrentGame = (next: GameSession) => {
    setCurrentGame(next);
    announce('STAT UPDATED');
  };

  const syncTrackerData = async (nextData: StatTrackerData) => {
    if (cloudProject) {
      const saved = await updateProject.mutateAsync({
        projectId: cloudProject.id,
        data: { project: trackerPayload(nextData), expectedRevision: cloudProject.revision },
      });
      setCloudProject({ id: saved.id, revision: saved.revision });
    } else {
      const created = await createProject.mutateAsync({
        data: { name: `${profile.athleteName || 'Athlete'} — Stat Tracker`, project: trackerPayload(nextData), guestUsageKey },
      });
      setCloudProject({ id: created.id, revision: created.revision });
    }
    await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
  };

  const saveCompletedGame = async () => {
    if (!currentGame) return;
    const completed = endGame(currentGame);
    const nextData = { ...data, games: [...data.games, completed] };
    setData(nextData);
    setCurrentGame(null);
    setSaving(true);
    setError('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    try {
      await syncTrackerData(nextData);
      announce('GAME SAVED — SEASON TOTALS UPDATED');
    } catch (saveError: any) {
      setError(trackerSaveErrorMessage(saveError));
      setRevisionConflict(isTrackerRevisionConflict(saveError));
      setRetryAvailable(!isTrackerRevisionConflict(saveError));
      announce('LOCAL COPY SAVED — CLOUD SYNC NEEDS ATTENTION');
    } finally {
      setSaving(false);
    }
  };

  const retryCloudSync = async () => {
    if (saving || !retryAvailable) return;
    setSaving(true);
    setError('');
    try {
      await syncTrackerData(data);
      setRetryAvailable(false);
      setRevisionConflict(false);
      announce('CLOUD SYNC RESTORED — SEASON HISTORY IS SAFE');
    } catch (saveError: any) {
      const conflict = isTrackerRevisionConflict(saveError);
      setError(trackerSaveErrorMessage(saveError));
      setRevisionConflict(conflict);
      setRetryAvailable(!conflict);
      announce('LOCAL COPY STILL SAFE — CLOUD SYNC NEEDS ATTENTION');
    } finally {
      setSaving(false);
    }
  };

  const eventLabel = (statId: string) => rule.stats.find((item) => item.id === statId)?.label ?? statId;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 sm:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/studio" className="mb-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Game Day Hub
          </Link>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Live numbers</p>
          <h1 className="mt-2 font-display text-5xl uppercase tracking-tight sm:text-7xl">STAT <span className="text-primary">TRACKER.</span></h1>
          <p className="mt-3 max-w-2xl text-sm font-medium text-muted-foreground sm:text-base">Tap each play as it happens. Finish the game to add it to your season history.</p>
        </div>
        <div className="border border-border bg-card px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground clip-angled-sm">
          {saving ? 'Saving to cloud…' : cloudProject ? 'Cloud sync active' : 'Local copy ready'}
        </div>
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto border-b border-border pb-1" role="tablist" aria-label="Choose athlete sport">
        {sports.map((option) => (
          <button key={option} type="button" role="tab" aria-selected={sport === option} onClick={() => !currentGame && setSport(option)} disabled={Boolean(currentGame)} className={`shrink-0 border-b-4 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed ${sport === option ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {getSportRule(option).label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-5 flex flex-col gap-3 border-l-4 border-destructive bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p>{error}</p>
          {retryAvailable && (
            <button type="button" disabled={saving} onClick={() => void retryCloudSync()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-destructive px-3 py-2 text-xs font-bold uppercase tracking-widest text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50">
              <RotateCcw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> {saving ? 'Retrying…' : 'Retry cloud sync'}
            </button>
          )}
          {revisionConflict && (
            <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-destructive px-3 py-2 text-xs font-bold uppercase tracking-widest text-destructive hover:bg-destructive hover:text-destructive-foreground">
              <RotateCcw className="h-4 w-4" /> Refresh to merge
            </button>
          )}
        </div>
      )}

      {!currentGame ? (
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="border border-border bg-card p-6 clip-angled-sm sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-widest text-primary">New game</p><h2 className="mt-2 font-display text-4xl uppercase tracking-wide">{rule.label}</h2></div>
              <Trophy className="h-7 w-7 text-primary" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
               <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Game date
                 <input type="date" value={date} onChange={(event) => { manuallyEditedSetup.current.date = true; setDate(event.target.value); }} className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
              </label>
               <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Opponent
                 <input value={opponent} onChange={(event) => { manuallyEditedSetup.current.opponent = true; setOpponent(event.target.value); }} placeholder="Opponent name" className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
              </label>
            </div>
             <label className="mt-5 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Game notes
               <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What should you remember about this game?" rows={3} className="mt-2 w-full resize-y border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
             </label>
            {nextGame && <p className="mt-5 border-l-2 border-primary pl-3 text-xs font-medium text-muted-foreground">Prefilled from your next scheduled game. You can change it before starting.</p>}
            <button type="button" onClick={beginGame} className="mt-8 inline-flex min-h-12 items-center gap-2 bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm hover:brightness-110">
              <Clock3 className="h-4 w-4" /> Start game
            </button>
          </div>
          <section className="border border-border bg-foreground p-6 text-background clip-angled-sm sm:p-8">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Season snapshot</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="border border-white/10 bg-white/5 p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-white/55">Games</p><p className="mt-2 font-display text-4xl">{totals.gamesPlayed}</p></div>
              <div className="border border-white/10 bg-white/5 p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-white/55">Points</p><p className="mt-2 font-display text-4xl text-primary">{totals.score}</p></div>
            </div>
            <div className="mt-7 space-y-3">
              {rule.stats.filter((item) => totals.stats[item.id]).slice(0, 5).map((item) => <div key={item.id} className="flex items-center justify-between border-b border-white/10 pb-2 text-sm"><span className="font-bold uppercase tracking-wider text-white/70">{item.label}</span><span className="font-display text-2xl">{totals.stats[item.id]}</span></div>)}
              {!totals.gamesPlayed && <p className="text-sm text-white/60">Finish your first game to build the season view.</p>}
            </div>
          </section>
        </section>
      ) : (
        <section className="grid gap-3 lg:grid-cols-[0.85fr_1.15fr] lg:gap-6">
          <div className="lg:col-start-1 lg:row-start-1">
            <div className="border border-primary/40 bg-foreground p-3 text-background clip-angled-sm sm:p-6" aria-live="polite">
              <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2 bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground"><span className="h-2 w-2 animate-pulse bg-current" /> Live</span><span className="text-xs font-bold uppercase tracking-widest text-white/60">{formatDate(currentGame.date)}</span></div>
              <p className="mt-3 truncate text-xs font-bold uppercase tracking-widest text-white/60 sm:mt-7">{profile.teamName || 'Your team'} {currentGame.opponent ? `vs ${currentGame.opponent}` : '— opponent TBD'}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3">
                {([
                  ['athlete', profile.athleteName || 'Your score', currentGame.score],
                  ['opponent', currentGame.opponent || 'Opponent', currentGame.opponentScore],
                ] as const).map(([side, label, score]) => (
                  <div key={side} className="border border-white/10 bg-white/5 p-2 sm:p-3">
                    <p className="truncate text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</p>
                    <p className={`mt-1 font-display text-4xl leading-none sm:text-5xl ${side === 'athlete' ? 'text-primary' : 'text-white'}`}>{score}</p>
                    <div className="mt-2 flex gap-2 sm:mt-3">
                      <button type="button" onClick={() => updateCurrentGame(adjustScore(currentGame, side, -1))} aria-label={`Subtract one from ${label}`} className="flex h-8 w-8 items-center justify-center border border-white/20 text-white hover:bg-white/10 sm:h-9 sm:w-9"><Minus className="h-4 w-4" /></button>
                      <button type="button" onClick={() => updateCurrentGame(adjustScore(currentGame, side, 1))} aria-label={`Add one to ${label}`} className="flex h-8 w-8 items-center justify-center border border-white/20 text-white hover:bg-white/10 sm:h-9 sm:w-9"><Plus className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 sm:mt-4">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">Manual score adjustment</span>
                <span className="text-right font-display text-lg uppercase tracking-wide text-white/80 sm:text-xl">{rule.phaseLabel} {currentGame.period}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 sm:mt-7">
                <button type="button" onClick={() => setCurrentGame((game) => game ? { ...game, status: game.status === 'paused' ? 'live' : 'paused' } : game)} className="border border-white/20 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 sm:px-4 sm:py-3">{currentGame.status === 'paused' ? 'Resume' : 'Pause'}</button>
                <button type="button" onClick={() => setCurrentGame((game) => game ? { ...game, period: game.period + 1 } : game)} className="border border-white/20 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 sm:px-4 sm:py-3">Next {rule.phaseLabel}</button>
              </div>
            </div>
          </div>
          <div className="order-2 border border-border bg-card p-4 clip-angled-sm sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">Tap a stat</p><h2 className="mt-1 font-display text-3xl uppercase tracking-wide">{profile.athleteName || 'Athlete'}</h2></div><span className="text-right text-xs font-bold uppercase tracking-widest text-muted-foreground">Count / points<br /><strong className="text-foreground">{Object.values(currentGame.stats).reduce((sum, count) => sum + count, 0)} plays / {currentGame.score} pts</strong></span></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {displayStats.map((item) => <button key={item.id} type="button" onClick={() => updateCurrentGame(addStatEvent(currentGame, item.id))} className="group min-h-[88px] border border-border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground group-hover:text-primary">{item.label}</span><span className="mt-2 block font-display text-2xl uppercase">{item.shortLabel}</span><span className="mt-1 block text-xs font-bold text-primary">{currentGame.stats[item.id] ?? 0}{item.points ? ` · +${item.points}` : ' · tracked'}</span></button>)}
            </div>
            <button type="button" onClick={() => setShowAllStats((value) => !value)} className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">{showAllStats ? 'Show featured stats' : 'Show more stats'} <ChevronDown className={`h-4 w-4 transition-transform ${showAllStats ? 'rotate-180' : ''}`} /></button>
             <label className="mt-7 block border-t border-border pt-5 text-xs font-bold uppercase tracking-widest text-muted-foreground"><span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Game notes</span>
               <textarea value={currentGame.notes} onChange={(event) => setCurrentGame((game) => game ? { ...game, notes: event.target.value } : game)} placeholder="Add a note to look back on later." rows={4} className="mt-2 w-full resize-y border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
             </label>
            <div className="mt-7 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:justify-between">
              <button type="button" onClick={() => setCurrentGame(null)} className="inline-flex min-h-12 items-center justify-center gap-2 border border-border px-5 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"><Minus className="h-4 w-4" /> Leave game open</button>
              <button type="button" disabled={saving} onClick={() => void saveCompletedGame()} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110 disabled:opacity-50"><CircleStop className="h-4 w-4" /> {saving ? 'Saving…' : 'End & save game'}</button>
            </div>
          </div>
          <div className="order-3 border border-border bg-card p-4 clip-angled-sm sm:p-5 lg:col-start-1 lg:row-start-2">
            <div className="mb-4 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-widest text-primary">Recent activity</p><History className="h-4 w-4 text-muted-foreground" /></div>
            <div className="space-y-2">
              {currentGame.events.slice(-5).reverse().map((event) => <div key={event.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 text-sm"><span className="min-w-0 truncate font-medium">{eventLabel(event.statId)}</span><span className="shrink-0 text-xs text-muted-foreground">{rule.phaseLabel} {event.period} · {formatEventTime(event.createdAt)}</span></div>)}
              {!currentGame.events.length && <p className="text-sm text-muted-foreground">Your taps will appear here.</p>}
            </div>
            <button type="button" onClick={() => updateCurrentGame(undoLastStatEvent(currentGame))} disabled={!currentGame.events.length} className="mt-5 inline-flex min-h-11 items-center gap-2 border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Undo last</button>
          </div>
        </section>
      )}

      <section className="mt-10 border border-border bg-card p-5 clip-angled-sm sm:p-7">
        <div className="mb-5 flex items-center justify-between border-b border-border pb-3"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">Game history</p><h2 className="mt-1 font-display text-3xl uppercase tracking-wide">{rule.label} season</h2></div><Save className="h-5 w-5 text-muted-foreground" /></div>
         {data.games.filter((game) => game.sport === sport).length ? <div className="grid gap-3 md:grid-cols-2">{data.games.filter((game) => game.sport === sport).slice().reverse().map((game) => <div key={game.id} className="border border-border bg-background p-4"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="truncate font-display text-xl uppercase">{game.opponent ? `vs ${game.opponent}` : 'Game'}</p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{formatDate(game.date)} · {game.events.length} plays</p></div><div className="shrink-0 text-right"><p className="font-display text-3xl text-primary">{game.score}<span className="px-1 text-muted-foreground">–</span><span className="text-foreground">{game.opponentScore}</span></p><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">final score</p></div></div>{game.notes && <p className="mt-4 border-t border-border/60 pt-3 text-sm font-medium text-muted-foreground"><FileText className="mr-2 inline h-3.5 w-3.5 text-primary" />{game.notes}</p>}</div>)}</div> : <p className="text-sm text-muted-foreground">No completed {rule.label.toLowerCase()} games yet.</p>}
      </section>
      {notice && <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 border border-primary bg-foreground px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary shadow-lg" role="status"><Check className="h-4 w-4" /> {notice}</div>}
    </div>
  );
}
