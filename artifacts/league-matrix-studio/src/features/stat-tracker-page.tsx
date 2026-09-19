import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Check, ChevronDown, CircleStop, Clock3, CloudUpload, FileText, GitMerge, History, Loader2, Minus, Plus, RotateCcw, Save, Trophy } from 'lucide-react';
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
import {
  readScheduleDraft,
  saveScheduleDraft,
  updateScheduleEventStatus,
  type ScheduleEvent,
  type ScheduleEventStatus,
} from './schedule-draft';
import {
  addStatEvent,
  adjustScore,
  clearStoredTrackerConflict,
  createGameSession,
  endGame,
  getSportRule,
  getTrackerSportForProfile,
  getTrackerConflict,
  getTrackerStorageKeys,
  getTrackerSyncRecovery,
  mergeTrackerData,
  normalizeTrackerData,
  readStoredActiveGame,
  readStoredTrackerConflict,
  readStoredTrackerData,
  saveStoredTrackerConflict,
  seasonTotals,
  sports,
  syncTrackerDataToCloud,
  undoLastStatEvent,
  buildGameReport,
  type GameSession,
  type Sport,
  type StatTrackerData,
  type StatDefinition,
  type SportRule,
  type TrackerStorage,
  type TrackerConflict,
  type TrackerConflictResolution,
} from './stat-tracker';
import { GameReportView } from './stat-tracker-game-report';

export function readLocalTrackerSession(storage: TrackerStorage, accountId: string) {
  return {
    data: readStoredTrackerData(storage, accountId),
    currentGame: readStoredActiveGame(storage, accountId),
  };
}

function saveLocalTracker(data: StatTrackerData, accountId: string) {
  window.localStorage.setItem(getTrackerStorageKeys(accountId).history, JSON.stringify(data));
}

type ScheduledGame = {
  id: string;
  type: string;
  date: string;
  time: string;
  opponent: string;
  status?: ScheduleEventStatus;
};

export function getNextScheduledGame(events: readonly ScheduledGame[] = (readScheduleDraft()?.events ?? [])) {
  const today = new Date().toISOString().slice(0, 10);
  return [...events]
    .filter((event) => (
      event.type === 'game'
      && event.status !== 'final'
      && (Boolean(event.status) || event.date >= today)
    ))
    .sort((a, b) => {
      const statusOrder = (status?: ScheduleEventStatus) => status === 'live' ? 0 : 1;
      return statusOrder(a.status) - statusOrder(b.status)
        || `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
    })[0];
}

function isScheduleProject(value: unknown): value is { tool: 'schedule'; events: ScheduleEvent[] } {
  return typeof value === 'object'
    && value !== null
    && (value as { tool?: unknown }).tool === 'schedule'
    && Array.isArray((value as { events?: unknown }).events);
}

type OwnedScheduleProject = {
  id: string;
  revision: number;
  project: { tool: 'schedule'; events: ScheduleEvent[] };
};

export async function persistScheduledGameStatus({
  scheduledGame,
  status,
  canWrite,
  storage,
  ownedScheduleProject,
  expectedRevision,
  updateCloudProject,
}: {
  scheduledGame: ScheduledGame | undefined;
  status: ScheduleEventStatus;
  canWrite: boolean;
  storage: Storage;
  ownedScheduleProject?: OwnedScheduleProject;
  expectedRevision?: number;
  updateCloudProject: (input: {
    projectId: string;
    data: {
      project: OwnedScheduleProject['project'];
      expectedRevision: number;
    };
  }) => Promise<{ revision: number }>;
}) {
  if (!scheduledGame || !canWrite) return null;

  const matchesScheduledGame = (event: ScheduleEvent) => (
    event.id === scheduledGame.id
    || (
      event.type === 'game'
      && event.date === scheduledGame.date
      && event.opponent === scheduledGame.opponent
    )
  );
  const localDraft = readScheduleDraft(storage);
  const localEvent = localDraft?.events.find(matchesScheduledGame);
  if (localDraft && localEvent) {
    saveScheduleDraft(storage, {
      ...localDraft,
      events: updateScheduleEventStatus(localDraft.events, localEvent.id, status),
    });
  }

  if (!ownedScheduleProject) return null;
  const cloudEvent = ownedScheduleProject.project.events.find(matchesScheduledGame);
  if (!cloudEvent) return null;

  return updateCloudProject({
    projectId: ownedScheduleProject.id,
    data: {
      project: {
        ...ownedScheduleProject.project,
        events: updateScheduleEventStatus(ownedScheduleProject.project.events, cloudEvent.id, status),
      },
      expectedRevision: expectedRevision ?? ownedScheduleProject.revision,
    },
  });
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

function ConflictHistoryPreview({
  label,
  data,
  accent = false,
}: {
  label: string;
  data: StatTrackerData;
  accent?: boolean;
}) {
  const games = data.games.slice().reverse();

  return (
    <div className={`border p-4 ${accent ? 'border-primary/60 bg-primary/5' : 'border-border bg-background'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-widest ${accent ? 'text-primary' : 'text-muted-foreground'}`}>{label}</p>
          <p className="mt-1 font-display text-2xl uppercase">{data.games.length} {data.games.length === 1 ? 'game' : 'games'}</p>
        </div>
        {accent && <span className="border border-primary/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">On this device</span>}
      </div>
      <div className="mt-4 space-y-2">
        {games.slice(0, 4).map((game) => (
          <div key={game.id} className="flex items-center justify-between gap-3 border-t border-border/70 pt-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-bold">{game.opponent ? `vs ${game.opponent}` : 'Game'}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{formatDate(game.date)} · {game.sport}</p>
            </div>
            <span className="shrink-0 font-display text-xl text-primary">{game.score}–{game.opponentScore}</span>
          </div>
        ))}
        {!games.length && <p className="border-t border-border/70 pt-2 text-sm text-muted-foreground">No completed games in this copy.</p>}
        {games.length > 4 && <p className="pt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">+ {games.length - 4} more games</p>}
      </div>
    </div>
  );
}

type LiveTrackerGameProps = {
  currentGame: GameSession;
  rule: SportRule;
  athleteName: string;
  teamName: string;
  displayStats: StatDefinition[];
  showAllStats: boolean;
  saving: boolean;
  onGameChange: (game: GameSession) => void;
  onToggleShowAllStats: () => void;
  onLeaveGame: () => void;
  onEndGame: () => void;
};

export function LiveTrackerGame({
  currentGame,
  rule,
  athleteName,
  teamName,
  displayStats,
  showAllStats,
  saving,
  onGameChange,
  onToggleShowAllStats,
  onLeaveGame,
  onEndGame,
}: LiveTrackerGameProps) {
  const updateCurrentGame = (next: GameSession) => onGameChange(next);
  const eventLabel = (statId: string) => rule.stats.find((item) => item.id === statId)?.label ?? statId;

  return (
    <section data-testid="live-tracker-layout" className="grid gap-3 lg:grid-cols-[0.85fr_1.15fr] lg:gap-6">
      <div className="order-1 lg:col-start-1 lg:row-start-1">
        <div data-testid="live-tracker-scoreboard" className="min-w-0 border border-primary/40 bg-foreground p-3 text-background clip-angled-sm sm:p-6" aria-live="polite">
          <div className="flex min-w-0 items-center justify-between gap-3"><span className="inline-flex shrink-0 items-center gap-2 bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground"><span className="h-2 w-2 animate-pulse bg-current" /> Live</span><span className="min-w-0 truncate text-right text-xs font-bold uppercase tracking-widest text-white/60">{formatDate(currentGame.date)}</span></div>
          <p data-testid="live-tracker-matchup" className="mt-3 min-w-0 truncate text-xs font-bold uppercase tracking-widest text-white/60 sm:mt-7">{teamName || 'Your team'} {currentGame.opponent ? `vs ${currentGame.opponent}` : '— opponent TBD'}</p>
          <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:mt-5 sm:gap-3">
            {([
              ['athlete', athleteName || 'Your score', currentGame.score],
              ['opponent', currentGame.opponent || 'Opponent', currentGame.opponentScore],
            ] as const).map(([side, label, score]) => (
              <div key={side} data-testid={`live-tracker-score-card-${side}`} className="min-w-0 border border-white/10 bg-white/5 p-2 sm:p-3">
                <p className="truncate text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</p>
                <p className={`mt-1 font-display text-4xl leading-none sm:text-5xl ${side === 'athlete' ? 'text-primary' : 'text-white'}`}>{score}</p>
                <div className="mt-2 flex flex-wrap gap-2 sm:mt-3">
                  <button type="button" onClick={() => updateCurrentGame(adjustScore(currentGame, side, -1))} aria-label={`Subtract one from ${label}`} data-testid={`score-adjust-${side}-decrease`} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center border border-white/20 text-white hover:bg-white/10"><Minus className="h-4 w-4" /></button>
                  <button type="button" onClick={() => updateCurrentGame(adjustScore(currentGame, side, 1))} aria-label={`Add one to ${label}`} data-testid={`score-adjust-${side}-increase`} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center border border-white/20 text-white hover:bg-white/10"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-4 sm:mt-4">
            <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-widest text-white/45">Manual score adjustment</span>
            <span className="shrink-0 text-right font-display text-lg uppercase tracking-wide text-white/80 sm:text-xl">{rule.phaseLabel} {currentGame.period}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 sm:mt-7">
            <button type="button" onClick={() => onGameChange({ ...currentGame, status: currentGame.status === 'paused' ? 'live' : 'paused' })} className="border border-white/20 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 sm:px-4 sm:py-3">{currentGame.status === 'paused' ? 'Resume' : 'Pause'}</button>
            <button type="button" onClick={() => onGameChange({ ...currentGame, period: currentGame.period + 1 })} className="border border-white/20 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 sm:px-4 sm:py-3">Next {rule.phaseLabel}</button>
          </div>
        </div>
      </div>
      <div data-testid="live-tracker-stat-controls" className="order-2 min-w-0 border border-border bg-card p-4 clip-angled-sm sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="mb-5 flex min-w-0 items-end justify-between gap-4"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-widest text-primary">Tap a stat</p><h2 className="mt-1 break-words font-display text-3xl uppercase tracking-wide">{athleteName || 'Athlete'}</h2></div><span className="shrink-0 text-right text-xs font-bold uppercase tracking-widest text-muted-foreground">Count / points<br /><strong className="whitespace-nowrap text-foreground">{Object.values(currentGame.stats).reduce((sum, count) => sum + count, 0)} plays / {currentGame.score} pts</strong></span></div>
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
          {displayStats.map((item) => <button key={item.id} type="button" data-testid={`live-stat-${item.id}`} onClick={() => updateCurrentGame(addStatEvent(currentGame, item.id))} className="group min-h-[88px] min-w-0 overflow-hidden border border-border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className="block truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground group-hover:text-primary">{item.label}</span><span className="mt-2 block truncate font-display text-2xl uppercase">{item.shortLabel}</span><span className="mt-1 block truncate text-xs font-bold text-primary">{currentGame.stats[item.id] ?? 0}{item.points ? ` · +${item.points}` : ' · tracked'}</span></button>)}
        </div>
        <button type="button" onClick={onToggleShowAllStats} className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">{showAllStats ? 'Show featured stats' : 'Show more stats'} <ChevronDown className={`h-4 w-4 transition-transform ${showAllStats ? 'rotate-180' : ''}`} /></button>
        <label className="mt-7 block border-t border-border pt-5 text-xs font-bold uppercase tracking-widest text-muted-foreground"><span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Game notes</span>
          <textarea value={currentGame.notes} onChange={(event) => onGameChange({ ...currentGame, notes: event.target.value })} placeholder="Add a note to look back on later." rows={4} className="mt-2 w-full resize-y border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
        </label>
        <div className="mt-7 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:justify-between">
          <button type="button" onClick={onLeaveGame} className="inline-flex min-h-12 items-center justify-center gap-2 border border-border px-5 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"><Minus className="h-4 w-4" /> Leave game open</button>
          <button type="button" disabled={saving} onClick={onEndGame} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110 disabled:opacity-50"><CircleStop className="h-4 w-4" /> {saving ? 'Saving…' : 'End & save game'}</button>
        </div>
      </div>
      <div data-testid="live-tracker-recent-activity" className="order-3 border border-border bg-card p-4 clip-angled-sm sm:p-5 lg:col-start-1 lg:row-start-2">
        <div className="mb-4 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-widest text-primary">Recent activity</p><History className="h-4 w-4 text-muted-foreground" /></div>
        <div className="space-y-2">
          {currentGame.events.slice(-5).reverse().map((event) => <div key={event.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 text-sm"><span className="min-w-0 truncate font-medium">{eventLabel(event.statId)}</span><span className="shrink-0 text-xs text-muted-foreground">{rule.phaseLabel} {event.period} · {formatEventTime(event.createdAt)}</span></div>)}
          {!currentGame.events.length && <p className="text-sm text-muted-foreground">Your taps will appear here.</p>}
        </div>
        <button type="button" onClick={() => updateCurrentGame(undoLastStatEvent(currentGame))} disabled={!currentGame.events.length} className="mt-5 inline-flex min-h-11 items-center gap-2 border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Undo last</button>
      </div>
    </section>
  );
}


export function StatTrackerPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded, isSignedIn } = useUser();
  const accountId = isLoaded && isSignedIn && user?.id ? user.id : null;
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
  const [storageAccountId, setStorageAccountId] = useState<string | null>(null);
  const [data, setData] = useState<StatTrackerData>(() => normalizeTrackerData(null));
  const [currentGame, setCurrentGame] = useState<GameSession | null>(null);
  const [date, setDate] = useState(searchParams.get('date') ?? localNextGame?.date ?? new Date().toISOString().slice(0, 10));
  const [opponent, setOpponent] = useState(searchParams.get('opponent') ?? localNextGame?.opponent ?? '');
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [trackerConflict, setTrackerConflict] = useState<TrackerConflict | null>(null);
  const [selectedConflictResolution, setSelectedConflictResolution] = useState<'local' | 'cloud' | 'merge' | null>(null);
  const [showAllStats, setShowAllStats] = useState(false);
  const [selectedReportGameId, setSelectedReportGameId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('reportGame')
  ));
  const [cloudProject, setCloudProject] = useState<{ id: string; revision: number } | null>(null);
  const initializedCloud = useRef(false);
  const manuallyEditedSetup = useRef({
    date: searchParams.has('date'),
    opponent: searchParams.has('opponent'),
  });
  const connectedPrefillApplied = useRef(false);
  const activeScheduledGame = useRef<ScheduledGame | undefined>(undefined);
  const scheduleRevision = useRef<{ id: string; revision: number } | null>(null);
  const scheduledStatusUpdate = useRef(Promise.resolve());
  const guestUsageKey = useRef(getGuestUsageKey('lineup', 'stat-tracker')).current;
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const { data: accountAccess } = useGetAccountAccess({
    query: {
      enabled: Boolean(accountId),
      staleTime: 15000,
      queryKey: [...getGetAccountAccessQueryKey(), accountId],
    },
  });
  const { data: projects } = useListProjects({
    query: {
      enabled: Boolean(accountId && accountAccess),
      queryKey: [...getListProjectsQueryKey(), accountId],
    },
  });

  const ownedScheduleProject = useMemo(
    () => (projects ?? []).find((project) => isScheduleProject(project.project)),
    [projects],
  );
  const ownedSchedule = ownedScheduleProject && isScheduleProject(ownedScheduleProject.project)
    ? ownedScheduleProject.project
    : null;
  const ownedScheduleNextGame = useMemo(
    () => getNextScheduledGame(ownedSchedule?.events),
    [ownedSchedule?.events],
  );

  useEffect(() => {
    initializedCloud.current = false;
    setCloudProject(null);
    setStorageAccountId(null);
    setTrackerConflict(null);
    setSelectedConflictResolution(null);
    if (!accountId) {
      setData(normalizeTrackerData(null));
      setCurrentGame(null);
      return;
    }

    const restored = readLocalTrackerSession(window.localStorage, accountId);
    setData(restored.data);
    setCurrentGame(restored.currentGame);
    setSport(getTrackerSportForProfile(restored.data, profile.sport));
    setStorageAccountId(accountId);
  }, [accountId]);

  useEffect(() => {
    if (!accountId || storageAccountId !== accountId) return;
    const existing = (projects ?? [])
      .filter((project) => project.project.tool === 'stat-tracker')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!existing || initializedCloud.current) return;
    initializedCloud.current = true;
    const pendingConflict = readStoredTrackerConflict(window.localStorage, accountId);
    if (pendingConflict && pendingConflict.cloudProject.id === existing.id) {
      const currentCloudData = normalizeTrackerData(existing.project);
      const currentCloudProject = { id: existing.id, revision: existing.revision };
      const restoredConflict: TrackerConflict = {
        localData: pendingConflict.data,
        cloudData: currentCloudData,
        cloudProject: currentCloudProject,
      };
      setData(pendingConflict.data);
      setSport(getTrackerSportForProfile(pendingConflict.data, profile.sport));
      setCloudProject(currentCloudProject);
      setTrackerConflict(restoredConflict);
      setSelectedConflictResolution(pendingConflict.resolution);
      setRevisionConflict(true);
      setError('A history choice is ready to sync. Your selected result is still saved on this device.');
      saveStoredTrackerConflict(window.localStorage, accountId, {
        resolution: pendingConflict.resolution,
        data: pendingConflict.data,
        cloudData: currentCloudData,
        cloudProject: currentCloudProject,
      });
      return;
    }
    const mergedData = mergeTrackerData(readLocalTrackerSession(window.localStorage, accountId).data, existing.project);
    setData(mergedData);
    setSport(getTrackerSportForProfile(mergedData, profile.sport));
    setCloudProject({ id: existing.id, revision: existing.revision });
    saveLocalTracker(mergedData, accountId);
  }, [accountId, projects, storageAccountId]);

  useEffect(() => {
    if (accountId && storageAccountId === accountId) saveLocalTracker(data, accountId);
  }, [accountId, data, storageAccountId]);

  useEffect(() => {
    if (!accountId || storageAccountId !== accountId) return;
    const key = getTrackerStorageKeys(accountId).activeGame;
    if (currentGame) window.localStorage.setItem(key, JSON.stringify(currentGame));
    else window.localStorage.removeItem(key);
  }, [accountId, currentGame, storageAccountId]);

  useEffect(() => {
    if (!connectedNextGame || connectedPrefillApplied.current) return;
    connectedPrefillApplied.current = true;
    if (!manuallyEditedSetup.current.date) setDate(connectedNextGame.date);
    if (!manuallyEditedSetup.current.opponent) setOpponent(connectedNextGame.opponent);
  }, [connectedNextGame]);

  const rule = getSportRule(sport);
  const totals = seasonTotals(data.games, sport);
  const displayStats = rule.stats.filter((item) => showAllStats || item.featured);
  const nextGame = connectedNextGame ?? ownedScheduleNextGame ?? localNextGame;
  const report = useMemo(() => {
    if (!selectedReportGameId) return null;
    return buildGameReport(data.games, sport, selectedReportGameId);
  }, [data.games, sport, selectedReportGameId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (selectedReportGameId) url.searchParams.set('reportGame', selectedReportGameId);
    else url.searchParams.delete('reportGame');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [selectedReportGameId]);
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };

  const updateOwnedScheduledGameStatus = (
    scheduledGame: ScheduledGame | undefined,
    status: ScheduleEventStatus,
  ) => {
    scheduledStatusUpdate.current = scheduledStatusUpdate.current
      .catch(() => undefined)
      .then(async () => {
        const project = ownedScheduleProject && isScheduleProject(ownedScheduleProject.project)
          ? {
              id: ownedScheduleProject.id,
              revision: ownedScheduleProject.revision,
              project: ownedScheduleProject.project,
            }
          : undefined;
        const updated = await persistScheduledGameStatus({
          scheduledGame,
          status,
          canWrite: profile.role === 'fan' && !calendarConnection,
          storage: window.localStorage,
          ownedScheduleProject: project,
          expectedRevision: project && scheduleRevision.current?.id === project.id
            ? scheduleRevision.current.revision
            : undefined,
          updateCloudProject: (input) => updateProject.mutateAsync(input),
        });
        if (!project || !updated) return;
        scheduleRevision.current = { id: project.id, revision: updated.revision };
        await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      })
      .catch(() => undefined);
  };

  if (!isLoaded || (isSignedIn && storageAccountId !== accountId)) return <div className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground">Loading tracker…</div>;
  if (!isSignedIn) {
    setLocation('/sign-in?redirect_url=%2Fstudio%2Fstat-tracker');
    return null;
  }

  const beginGame = () => {
    setError('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    setTrackerConflict(null);
    setSelectedConflictResolution(null);
    activeScheduledGame.current = nextGame
      && nextGame.date === date
      && nextGame.opponent === opponent
      ? nextGame
      : undefined;
    setCurrentGame(createGameSession(sport, { date, opponent, notes }));
    updateOwnedScheduledGameStatus(activeScheduledGame.current, 'live');
    announce('GAME STARTED — LIVE STATS ARE READY');
  };

  const updateCurrentGame = (next: GameSession) => {
    setCurrentGame(next);
    announce('STAT UPDATED');
  };

  const syncTrackerData = async (nextData: StatTrackerData) => {
    const saved = await syncTrackerDataToCloud({
      data: nextData,
      cloudProject,
      athleteName: profile.athleteName,
      guestUsageKey,
      client: {
        createProject: (input) => createProject.mutateAsync(input),
        updateProject: (input) => updateProject.mutateAsync(input),
      },
    });
    setCloudProject({ id: saved.id, revision: saved.revision });
    await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
  };

  const saveCompletedGame = async () => {
    if (!currentGame) return;
    const completed = endGame(currentGame);
    updateOwnedScheduledGameStatus(activeScheduledGame.current, 'final');
    const nextData = { ...data, games: [...data.games, completed] };
    setData(nextData);
    setCurrentGame(null);
    setSaving(true);
    setError('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    setTrackerConflict(null);
    setSelectedConflictResolution(null);
    try {
      await syncTrackerData(nextData);
      if (accountId) clearStoredTrackerConflict(window.localStorage, accountId);
      announce('GAME SAVED — SEASON TOTALS UPDATED');
    } catch (saveError: any) {
      const recovery = getTrackerSyncRecovery(saveError);
      const conflict = getTrackerConflict(saveError, nextData);
      setError(recovery.message);
      setRevisionConflict(recovery.revisionConflict);
      setRetryAvailable(recovery.retryAvailable);
      setTrackerConflict(conflict);
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
      if (accountId) clearStoredTrackerConflict(window.localStorage, accountId);
      setRetryAvailable(false);
      setRevisionConflict(false);
      setTrackerConflict(null);
      setSelectedConflictResolution(null);
      announce('CLOUD SYNC RESTORED — SEASON HISTORY IS SAFE');
    } catch (saveError: any) {
      const recovery = getTrackerSyncRecovery(saveError);
      const conflict = getTrackerConflict(saveError, data);
      setError(recovery.message);
      setRevisionConflict(recovery.revisionConflict);
      setRetryAvailable(recovery.retryAvailable);
      setTrackerConflict(conflict ?? trackerConflict);
      announce('LOCAL COPY STILL SAFE — CLOUD SYNC NEEDS ATTENTION');
    } finally {
      setSaving(false);
    }
  };

  const chooseConflictResolution = (resolution: TrackerConflictResolution) => {
    if (!trackerConflict || !accountId || saving) return;

    const nextData = resolution === 'local'
      ? trackerConflict.localData
      : resolution === 'cloud'
        ? trackerConflict.cloudData
        : mergeTrackerData(trackerConflict.localData, trackerConflict.cloudData);

    setData(nextData);
    saveLocalTracker(nextData, accountId);
    setCloudProject(trackerConflict.cloudProject);
    setSelectedConflictResolution(resolution);
    saveStoredTrackerConflict(window.localStorage, accountId, {
      resolution,
      data: nextData,
      cloudData: trackerConflict.cloudData,
      cloudProject: trackerConflict.cloudProject,
    });
    setRetryAvailable(false);
    setError('');
    announce(
      resolution === 'local'
        ? 'LOCAL HISTORY SELECTED — READY TO SYNC'
        : resolution === 'cloud'
          ? 'CLOUD HISTORY SELECTED — READY TO SYNC'
          : 'NON-OVERLAPPING GAMES MERGED — READY TO SYNC',
    );
  };

  const syncSelectedConflict = async () => {
    if (!trackerConflict || !selectedConflictResolution || saving) return;
    setSaving(true);
    setError('');
    setRetryAvailable(false);
    const selectedData = data;
    try {
      await syncTrackerData(selectedData);
      if (accountId) clearStoredTrackerConflict(window.localStorage, accountId);
      setRevisionConflict(false);
      setTrackerConflict(null);
      setSelectedConflictResolution(null);
      announce('HISTORY RESOLVED — CLOUD SYNC RESTORED');
    } catch (saveError: any) {
      const recovery = getTrackerSyncRecovery(saveError);
      const nextConflict = getTrackerConflict(saveError, selectedData);
      setError(recovery.message);
      setRevisionConflict(recovery.revisionConflict);
      setRetryAvailable(recovery.retryAvailable);
      setTrackerConflict(nextConflict ?? { ...trackerConflict, localData: selectedData });
      if (nextConflict) {
        setSelectedConflictResolution(null);
        if (accountId) {
          saveStoredTrackerConflict(window.localStorage, accountId, {
            resolution: null,
            data: selectedData,
            cloudData: nextConflict.cloudData,
            cloudProject: nextConflict.cloudProject,
          });
        }
      } else if (accountId) {
        saveStoredTrackerConflict(window.localStorage, accountId, {
          resolution: selectedConflictResolution,
          data: selectedData,
          cloudData: trackerConflict.cloudData,
          cloudProject: trackerConflict.cloudProject,
        });
      }
      announce('SELECTED HISTORY STILL SAFE — CLOUD SYNC NEEDS ATTENTION');
    } finally {
      setSaving(false);
    }
  };

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
        {(profile.sport ? [profile.sport] : sports).map((option) => (
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
          {revisionConflict && !trackerConflict && (
            <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-destructive px-3 py-2 text-xs font-bold uppercase tracking-widest text-destructive hover:bg-destructive hover:text-destructive-foreground">
              <RotateCcw className="h-4 w-4" /> Refresh to merge
            </button>
          )}
        </div>
      )}

      {revisionConflict && trackerConflict && (
        <section className="mb-6 border border-primary/50 bg-card p-5 clip-angled-sm sm:p-7" aria-labelledby="tracker-conflict-heading">
          <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">History needs a choice</p>
              <h2 id="tracker-conflict-heading" className="mt-1 font-display text-3xl uppercase tracking-wide">Newer cloud copy found</h2>
              <p className="mt-2 max-w-3xl text-sm font-medium text-muted-foreground">Your local history is preserved. Choose a copy or merge games that only exist in one history, then sync the selected result without leaving this page.</p>
            </div>
            <GitMerge className="hidden h-7 w-7 shrink-0 text-primary sm:block" />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <ConflictHistoryPreview label="Local copy" data={trackerConflict.localData} accent />
            <ConflictHistoryPreview label="Newer cloud copy" data={trackerConflict.cloudData} />
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Choose what to sync</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ['local', 'Keep local copy', 'Replace cloud history with this device’s history.'],
                ['cloud', 'Accept cloud copy', 'Use the newer cloud history on this device.'],
                ['merge', 'Merge new games', 'Keep games from both copies when IDs do not overlap.'],
              ] as const).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  disabled={saving}
                  onClick={() => chooseConflictResolution(value)}
                  className={`min-h-24 border p-3 text-left transition-colors disabled:opacity-50 ${selectedConflictResolution === value ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border bg-background hover:border-primary'}`}
                >
                  <span className="block text-xs font-bold uppercase tracking-widest">{label}</span>
                  <span className="mt-2 block text-xs font-medium leading-5 text-muted-foreground">{description}</span>
                </button>
              ))}
            </div>
            {selectedConflictResolution && (
              <div className="flex flex-col gap-3 border-l-2 border-primary bg-primary/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-bold">Selected history is saved on this device until cloud sync succeeds.</p>
                <button type="button" disabled={saving} onClick={() => void syncSelectedConflict()} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110 disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                  {saving ? 'Syncing selected history…' : 'Sync selected history'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {!currentGame ? (
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="border border-foreground/20 bg-muted/70 p-6 shadow-lg clip-angled-sm sm:p-8">
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
        <LiveTrackerGame
          currentGame={currentGame}
          rule={rule}
          athleteName={profile.athleteName}
          teamName={profile.teamName}
          displayStats={displayStats}
          showAllStats={showAllStats}
          saving={saving}
          onGameChange={(next) => { setCurrentGame(next); announce('STAT UPDATED'); }}
          onToggleShowAllStats={() => setShowAllStats((value) => !value)}
          onLeaveGame={() => setCurrentGame(null)}
          onEndGame={() => void saveCompletedGame()}
        />
      )}

      <section className="mt-10 border border-border bg-card p-5 clip-angled-sm sm:p-7">
        <div className="mb-5 flex items-center justify-between border-b border-border pb-3"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">Game history</p><h2 className="mt-1 font-display text-3xl uppercase tracking-wide">{rule.label} season</h2></div><Save className="h-5 w-5 text-muted-foreground" /></div>
         {data.games.filter((game) => game.sport === sport).length ? <div className="grid gap-3 md:grid-cols-2">{data.games.filter((game) => game.sport === sport).slice().reverse().map((game) => <button type="button" key={game.id} onClick={() => setSelectedReportGameId(game.id)} data-testid={`history-card-${game.id}`} className="group min-w-0 w-full text-left border border-border bg-background p-4 transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary clip-angled-sm"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="truncate font-display text-xl uppercase group-hover:text-primary transition-colors">{game.opponent ? `vs ${game.opponent}` : 'Game'}</p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{formatDate(game.date)} · {game.events.length} plays</p></div><div className="shrink-0 text-right"><p className="font-display text-3xl text-primary group-hover:scale-105 transition-transform origin-right">{game.score}<span className="px-1 text-muted-foreground">–</span><span className="text-foreground">{game.opponentScore}</span></p><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">final score</p></div></div>{game.notes && <p className="mt-4 border-t border-border/60 pt-3 text-sm font-medium text-muted-foreground truncate"><FileText className="mr-2 inline h-3.5 w-3.5 text-primary" />{game.notes}</p>}</button>)}</div> : <p className="text-sm text-muted-foreground">No completed {rule.label.toLowerCase()} games yet.</p>}
      </section>
      {report && (
        <GameReportView
          report={report}
          rule={rule}
          onClose={() => setSelectedReportGameId(null)}
          onSelectGame={setSelectedReportGameId}
        />
      )}
      {notice && <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 border border-primary bg-foreground px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary shadow-lg" role="status"><Check className="h-4 w-4" /> {notice}</div>}
    </div>
  );
}
