import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Camera, Check, ChevronDown, CircleStop, Clock3, CloudUpload, Copy, ExternalLink, FileText, GitMerge, History, Loader2, Minus, Plus, RotateCcw, Save, Share2, Trophy, Video, X } from 'lucide-react';
import { useUser } from '@clerk/react';
import {
  useCreateProject,
  useGetAccountAccess,
  useGetSupporterPhoto,
  useListProjects,
  useUpdateProject,
  getGetAccountAccessQueryKey,
  getGetSupporterPhotoQueryKey,
  getListProjectsQueryKey,
  useCreateStatTrackerShare,
  useDeleteStatTrackerShare,
  useListStatTrackerShares,
  useUpdateStatTrackerShare,
  getListStatTrackerSharesQueryKey,
  type StatTrackerShare,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

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
  addFootballPassReception,
  addStatEvent,
  adjustYardValue,
  adjustScore,
  baseballHitChoices,
  baseballPitchChoices,
  clearStoredTrackerConflict,
  countStatEventsByAttribution,
  createGameSession,
  createAthleteResultGame,
  endGame,
  footballYardMetricDefinitions,
  getFootballYardMetricId,
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
  saveStoredActiveGame,
  saveStoredTrackerConflict,
  seasonTotals,
  seasonYardTotals,
  sports,
  syncTrackerDataToCloud,
  trackerSaveStatusMessage,
  updateStatEventAttribution,
  updateStatEventYards,
  undoLastStatEvent,
  buildGameReport,
  type GameSession,
  type AthleteResultCapture,
  type Sport,
  type StatTrackerData,
  type StatDefinition,
  type StatAttribution,
  type SportRule,
  type TrackerStorage,
  type TrackerConflict,
  type TrackerConflictResolution,
  type TrackerSaveStatus,
} from './stat-tracker';
import { GameReportView } from './stat-tracker-game-report';
import { trackEvent } from '../lib/analytics';
import { toStatTrackerShareInput } from './stat-tracker-share';

const trackerBasePath = (
  (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
).replace(/\/$/, '');
const trackerAppOrigin = typeof window === 'undefined'
  ? ''
  : ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
    ? 'https://pixlsports.com'
    : window.location.origin;

export function readLocalTrackerSession(storage: TrackerStorage, accountId: string) {
  return {
    data: readStoredTrackerData(storage, accountId),
    currentGame: readStoredActiveGame(storage, accountId),
  };
}

function saveLocalTracker(data: StatTrackerData, accountId: string) {
  window.localStorage.setItem(getTrackerStorageKeys(accountId).history, JSON.stringify(data));
}

type TrackerSyncOutcome = 'cloud_success' | 'local_only_failure' | 'retry_success' | 'revision_conflict';
type TrackerSyncOperation = 'initial_save' | 'retry' | 'conflict_resolution';

function trackTrackerSyncOutcome(
  outcome: TrackerSyncOutcome,
  operation: TrackerSyncOperation,
  sport: Sport,
) {
  trackEvent('stat_tracker_sync_outcome', { outcome, operation, sport });
}

export type ScheduledGame = {
  id: string;
  type: string;
  date: string;
  time: string;
  opponent: string;
  status?: ScheduleEventStatus;
  completedAt?: string;
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

export function getSelectedScheduledGame(
  events: readonly ScheduledGame[] | undefined,
  eventId: string | null,
): ScheduledGame | undefined {
  if (!eventId) return undefined;
  return events?.find((event) => event.type === 'game' && event.id === eventId);
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
  completedAt,
  canWrite,
  storage,
  ownedScheduleProject,
  expectedRevision,
  updateCloudProject,
}: {
  scheduledGame: ScheduledGame | undefined;
  status: ScheduleEventStatus;
  completedAt?: string;
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
      events: updateScheduleEventStatus(localDraft.events, localEvent.id, status, completedAt),
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
        events: updateScheduleEventStatus(ownedScheduleProject.project.events, cloudEvent.id, status, completedAt),
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

export function StatTrackerSaveStatus({ status }: { status: TrackerSaveStatus }) {
  return (
    <div
      className={`inline-flex max-w-full min-w-0 items-start gap-2 border px-4 py-3 text-xs font-bold uppercase leading-5 tracking-widest clip-angled-sm ${
        status === 'local-saved'
          ? 'border-destructive/50 bg-destructive/5 text-destructive'
          : status === 'saving'
            ? 'border-primary/50 bg-primary/5 text-primary-ink'
            : 'border-primary/40 bg-primary/5 text-primary-ink'
      }`}
      role="status"
      aria-live="polite"
      data-testid="stat-tracker-save-status"
    >
      {status === 'saving'
        ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        : status === 'cloud-saved'
          ? <CloudUpload className="mt-0.5 h-4 w-4 shrink-0" />
          : <Save className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0 whitespace-normal break-words">{trackerSaveStatusMessage(status)}</span>
    </div>
  );
}

export function StatTrackerSaveRecoveryAlert({
  message,
  retryAvailable,
  revisionConflict,
  hasConflict,
  saving,
  onRetry,
  onRefresh,
}: {
  message: string;
  retryAvailable: boolean;
  revisionConflict: boolean;
  hasConflict: boolean;
  saving: boolean;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  if (!message) return null;
  return (
    <div className="mb-5 flex min-w-0 flex-col gap-3 border-l-4 border-destructive bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="stat-tracker-save-recovery">
      <p className="min-w-0 break-words leading-5">{message}</p>
      {retryAvailable && (
        <button type="button" disabled={saving} onClick={onRetry} data-testid="button-retry-stat-tracker-save" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-destructive px-3 py-2 text-xs font-bold uppercase tracking-widest text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50">
          <RotateCcw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> {saving ? 'Retrying…' : 'Retry cloud sync'}
        </button>
      )}
      {revisionConflict && !hasConflict && (
        <button type="button" onClick={onRefresh} data-testid="button-refresh-stat-tracker-conflict" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-destructive px-3 py-2 text-xs font-bold uppercase tracking-widest text-destructive hover:bg-destructive hover:text-destructive-foreground">
          <RotateCcw className="h-4 w-4" /> Refresh to merge
        </button>
      )}
    </div>
  );
}

export function StatTrackerUpcomingNotice({
  nextGame,
  onUseUpcomingGame,
  onDismiss,
  onToggleManualSetup,
  showManualSetup,
  hiddenOnDesktop = false,
}: {
  nextGame: ScheduledGame;
  onUseUpcomingGame: () => void;
  onDismiss: () => void;
  onToggleManualSetup: () => void;
  showManualSetup: boolean;
  hiddenOnDesktop?: boolean;
}) {
  return (
    <section className={`mb-6 flex flex-col gap-4 border border-primary/40 bg-primary/5 px-4 py-4 clip-angled-sm sm:flex-row sm:items-center sm:justify-between sm:px-5 ${hiddenOnDesktop ? 'lg:hidden' : ''}`} data-testid="stat-tracker-upcoming-notice" aria-live="polite">
      <div className="flex min-w-0 items-start gap-3">
        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-ink">Next game scheduled</p>
          <p className="mt-1 truncate text-sm font-bold uppercase">{formatDate(nextGame.date)} · {nextGame.opponent || 'Opponent TBD'}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Your tracker is ready to use this game’s details.</p>
        </div>
      </div>
      <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto lg:shrink-0">
        <button type="button" onClick={onUseUpcomingGame} data-testid="button-use-upcoming-game" className="inline-flex min-h-10 items-center justify-center gap-2 bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110">Use this game</button>
        <button type="button" onClick={onToggleManualSetup} aria-expanded={showManualSetup} aria-controls="manual-game-setup" data-testid="button-start-manual-game" className="ml-auto inline-flex min-h-10 items-center justify-center gap-1 border border-primary bg-primary/10 px-2 py-2 text-center text-[9px] font-bold uppercase leading-tight tracking-normal text-foreground hover:bg-primary/20 lg:hidden">
          Start manual game <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${showManualSetup ? 'rotate-180' : ''}`} />
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss upcoming game notification" data-testid="button-dismiss-upcoming-notice" className="hidden min-h-10 min-w-10 items-center justify-center border border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground lg:inline-flex"><X className="h-4 w-4" /></button>
      </div>
    </section>
  );
}

export function StatTrackerStartPanel({
  nextGame,
  label,
  date,
  opponent,
  notes,
  showManualSetup,
  onToggleManualSetup,
  onDateChange,
  onOpponentChange,
  onNotesChange,
  onStartGame,
  onReviewPreviousGames,
}: {
  nextGame?: ScheduledGame;
  label: string;
  date: string;
  opponent: string;
  notes: string;
  showManualSetup: boolean;
  onToggleManualSetup: () => void;
  onDateChange: (value: string) => void;
  onOpponentChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onStartGame: () => void;
  onReviewPreviousGames: () => void;
}) {
  return (
    <div className={`stat-tracker-light-text border border-foreground/20 bg-muted/70 p-6 shadow-lg clip-angled-sm sm:p-8 ${nextGame ? 'contents lg:block' : ''}`}>
      <div data-testid="stat-tracker-start-summary" className={`flex items-start justify-between gap-4 ${nextGame ? 'hidden lg:flex' : ''}`}>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-accent">{nextGame ? 'Scheduled game' : 'Blank tracker'}</p>
          <h2 className="mt-2 font-display text-4xl uppercase tracking-wide">{label}</h2>
          {!nextGame && <p className="mt-2 max-w-md text-sm font-medium leading-relaxed text-muted-foreground" data-testid="stat-tracker-blank-state">No game is scheduled yet. Start with a blank template, or review a previous game below.</p>}
        </div>
        <Trophy className="h-7 w-7 text-primary-ink" />
      </div>
      <button type="button" onClick={onToggleManualSetup} aria-expanded={showManualSetup} aria-controls="manual-game-setup" data-testid={nextGame ? 'button-start-manual-game-desktop' : 'button-start-manual-game'} className={`mt-6 min-h-11 items-center gap-2 border border-primary bg-primary/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-foreground hover:bg-primary/20 ${nextGame ? 'hidden lg:inline-flex' : 'inline-flex'}`}>
        <Clock3 className="h-4 w-4 text-primary-ink" /> Start manual game <ChevronDown className={`h-4 w-4 transition-transform ${showManualSetup ? 'rotate-180' : ''}`} />
      </button>
      {showManualSetup && <div id="manual-game-setup" className={`${nextGame ? 'stat-tracker-light-text border border-foreground/20 bg-muted/70 p-5 shadow-lg clip-angled-sm lg:mt-6 lg:border-x-0 lg:border-b-0 lg:border-t-border lg:bg-transparent lg:p-0 lg:pt-6 lg:shadow-none' : 'mt-6 border-t border-border pt-6'}`}>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Game date
            <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} data-testid="input-stat-tracker-date" className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
          </label>
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Opponent
            <input value={opponent} onChange={(event) => onOpponentChange(event.target.value)} placeholder="Opponent name" className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
          </label>
        </div>
        <label className="mt-5 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Game notes
          <textarea value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="What should you remember about this game?" rows={3} className="mt-2 w-full resize-y border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
        </label>
        {nextGame && <p className="mt-5 border-l-2 border-primary pl-3 text-xs font-medium text-muted-foreground">Prefilled from your next scheduled game. You can change it before starting.</p>}
        <button type="button" onClick={onStartGame} data-testid="button-confirm-start-game" className="mt-8 inline-flex min-h-12 items-center gap-2 bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm hover:brightness-110">
          <Clock3 className="h-4 w-4" /> Start game
        </button>
      </div>}
      {!nextGame && <div className="mt-5 flex flex-col gap-3 border-l-2 border-border pl-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium text-muted-foreground">No scheduled game details to prefill.</p>
        <button type="button" onClick={onReviewPreviousGames} data-testid="button-review-previous-games" className="inline-flex min-h-10 shrink-0 items-center gap-2 text-left text-xs font-bold uppercase tracking-widest text-primary-ink hover:text-foreground"><History className="h-4 w-4" /> Review previous games</button>
      </div>}
    </div>
  );
}

export function AthleteResultPanel({
  athleteName,
  teamName,
  rule,
  date,
  opponent,
  notes,
  saving,
  onDateChange,
  onOpponentChange,
  onNotesChange,
  onSave,
  onOpenAdvanced,
}: {
  athleteName: string;
  teamName: string;
  rule: SportRule;
  date: string;
  opponent: string;
  notes: string;
  saving: boolean;
  onDateChange: (value: string) => void;
  onOpponentChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onSave: (capture: AthleteResultCapture) => void;
  onOpenAdvanced: () => void;
}) {
  const [score, setScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [showStats, setShowStats] = useState(false);
  const [skippedStats, setSkippedStats] = useState(false);
  const statOptions = rule.stats.filter((stat) => !stat.liveHidden);
  const athleteLabel = athleteName || 'Your athlete';
  const setStatCount = (statId: string, value: number) => {
    const nextValue = Math.max(0, Math.min(99, Math.floor(Number.isFinite(value) ? value : 0)));
    setStats((current) => {
      if (!nextValue) {
        const next = { ...current };
        delete next[statId];
        return next;
      }
      return { ...current, [statId]: nextValue };
    });
    setSkippedStats(false);
  };
  const skipStats = () => {
    setStats({});
    setShowStats(false);
    setSkippedStats(true);
  };

  return (
    <section className="border border-border bg-card p-5 text-card-foreground clip-angled-sm sm:p-8" data-testid="athlete-result-panel" aria-labelledby="athlete-result-heading">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Athlete + result</p>
          <h2 id="athlete-result-heading" className="mt-1 font-display text-3xl uppercase tracking-wide">{athleteLabel}</h2>
          <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">Save the final score, then add only the stats or moments you want to remember.</p>
        </div>
        <Trophy className="h-7 w-7 shrink-0 text-primary-ink" />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Game date
          <input required type="date" value={date} onChange={(event) => onDateChange(event.currentTarget.value)} data-testid="input-athlete-result-date" className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
        </label>
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Opponent
          <input value={opponent} onChange={(event) => onOpponentChange(event.currentTarget.value)} placeholder="Opponent name (optional)" data-testid="input-athlete-result-opponent" className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
        </label>
      </div>

      <fieldset className="mt-6">
        <legend className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Final result</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {([
            ['athlete', teamName || athleteLabel, score, setScore],
            ['opponent', opponent || 'Opponent', opponentScore, setOpponentScore],
          ] as const).map(([side, label, value, setValue]) => (
            <label key={side} className="border border-border bg-background p-3">
              <span className="block truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
              <input type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => setValue(Math.max(0, Number.parseInt(event.currentTarget.value, 10) || 0))} data-testid={`input-athlete-result-score-${side}`} aria-label={`${label} final score`} className="mt-2 w-full border-0 bg-transparent p-0 font-display text-4xl text-foreground outline-none" />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 border border-primary/30 bg-primary/5 p-4" data-testid="athlete-result-stats-choice">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-foreground">Optional athlete stats</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">Add totals after the game. Every total is credited to {athleteLabel}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setShowStats((value) => !value); setSkippedStats(false); }} aria-expanded={showStats} data-testid="button-add-athlete-stats" className="inline-flex min-h-11 items-center gap-2 border border-primary bg-background px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-ink hover:bg-primary/10">
              {showStats ? 'Hide stats' : 'Add athlete stats'} <ChevronDown className={`h-4 w-4 transition-transform ${showStats ? 'rotate-180' : ''}`} />
            </button>
            <button type="button" onClick={skipStats} data-testid="button-skip-athlete-stats" className="inline-flex min-h-11 items-center border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-foreground">Skip stats</button>
          </div>
        </div>
        {skippedStats && <p className="mt-3 text-xs font-bold text-primary-ink" role="status">Stats skipped. You can save the result and notes now.</p>}
        {showStats && (
          <div className="mt-4 grid gap-3 border-t border-primary/20 pt-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="athlete-result-stat-fields">
            {statOptions.map((stat) => (
              <label key={stat.id} className="border border-border bg-background p-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {stat.label}
                <input type="number" min="0" max="99" step="1" inputMode="numeric" value={stats[stat.id] ?? 0} onChange={(event) => setStatCount(stat.id, Number.parseInt(event.currentTarget.value, 10) || 0)} data-testid={`input-athlete-result-stat-${stat.id}`} className="mt-2 w-full border border-border bg-card px-3 py-2 font-display text-2xl text-foreground outline-none focus:border-primary" />
              </label>
            ))}
          </div>
        )}
      </div>

      <label className="mt-6 block text-xs font-bold uppercase tracking-widest text-muted-foreground"><span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-primary-ink" /> Moments or notes</span>
        <textarea value={notes} onChange={(event) => onNotesChange(event.currentTarget.value)} placeholder="A favorite moment, milestone, or anything to remember." rows={4} data-testid="input-athlete-result-notes" className="mt-2 w-full resize-y border border-border bg-background px-4 py-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary" />
      </label>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onOpenAdvanced} data-testid="button-open-advanced-team-stats" className="inline-flex min-h-11 items-center justify-center border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-foreground">Advanced team stats</button>
        <button type="button" disabled={saving || !date} onClick={() => onSave({ date, opponent, score, opponentScore, notes, stats })} data-testid="button-save-athlete-result" className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {saving ? 'Saving result…' : 'Save game result'}
        </button>
      </div>
    </section>
  );
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function StatTrackerSharePanel({
  share,
  shareUrl,
  game,
  athleteName,
  teamName,
  busy,
  error,
  notice,
  onCreate,
  onRevoke,
  onCopy,
}: {
  share: StatTrackerShare | null;
  shareUrl: string;
  game: GameSession;
  athleteName: string;
  teamName: string;
  busy: boolean;
  error: string;
  notice: string;
  onCreate: () => void;
  onRevoke: () => void;
  onCopy: () => void;
}) {
  return (
    <section className="mb-6 border border-primary/40 bg-primary/5 p-4 clip-angled-sm sm:p-5" data-testid="stat-tracker-share-panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent"><Share2 className="h-4 w-4 text-accent" /> Live supporter link</p>
          <h2 className="mt-1 font-display text-2xl uppercase tracking-wide">Share the scoreboard</h2>
          <p className="mt-2 max-w-2xl text-xs font-medium leading-relaxed text-muted-foreground">Read-only view for this game. It shows the live score and recent plays, never private notes or editing controls. The link expires in 24 hours.</p>
        </div>
        {share && <span className="shrink-0 border border-primary/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-ink">Active · rev {share.revision}</span>}
      </div>
      {!share ? (
        <button type="button" disabled={busy} onClick={onCreate} data-testid="button-create-stat-tracker-share" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110 disabled:opacity-50">
          <Share2 className="h-4 w-4" /> {busy ? 'Creating link…' : 'Create supporter link'}
        </button>
      ) : (
        <div className="mt-4 flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} data-testid="input-stat-tracker-share-url" aria-label="Live supporter link" className="min-h-11 min-w-0 flex-1 border border-border bg-background px-3 py-2 text-xs font-medium text-foreground outline-none focus:border-primary" />
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={onCopy} data-testid="button-copy-stat-tracker-share" className="inline-flex min-h-11 items-center justify-center gap-2 border border-border bg-background px-3 py-2 text-xs font-bold uppercase tracking-widest hover:border-primary"><Copy className="h-4 w-4" /> Copy</button>
              <a href={shareUrl} target="_blank" rel="noreferrer" data-testid="link-open-stat-tracker-share" className="inline-flex min-h-11 items-center justify-center gap-2 border border-border bg-background px-3 py-2 text-xs font-bold uppercase tracking-widest hover:border-primary"><ExternalLink className="h-4 w-4" /> Open</a>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Expires {new Date(share.expiresAt).toLocaleString()}</p>
            <button type="button" disabled={busy} onClick={onRevoke} data-testid="button-revoke-stat-tracker-share" className="inline-flex min-h-10 items-center justify-center gap-2 border border-destructive/50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10 disabled:opacity-50">Revoke link</button>
          </div>
        </div>
      )}
      {notice && <p className="mt-3 text-xs font-bold text-primary-ink" role="status" data-testid="status-stat-tracker-share">{notice}</p>}
      {error && <p className="mt-3 text-xs font-bold text-destructive" role="alert" data-testid="error-stat-tracker-share">{error}</p>}
    </section>
  );
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
          <p className={`text-[10px] font-bold uppercase tracking-widest ${accent ? 'text-primary-ink' : 'text-muted-foreground'}`}>{label}</p>
          <p className="mt-1 font-display text-2xl uppercase">{data.games.length} {data.games.length === 1 ? 'game' : 'games'}</p>
        </div>
        {accent && <span className="border border-primary/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-ink">On this device</span>}
      </div>
      <div className="mt-4 space-y-2">
        {games.slice(0, 4).map((game) => (
          <div key={game.id} className="flex items-center justify-between gap-3 border-t border-border/70 pt-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-bold">{game.opponent ? `vs ${game.opponent}` : 'Game'}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{formatDate(game.date)} · {game.sport}</p>
            </div>
            <span className="shrink-0 font-display text-xl text-primary-ink">{game.score}–{game.opponentScore}</span>
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
  athleteImageUrl?: string;
  athleteImageCrop?: {
    x: number;
    y: number;
    zoom: number;
  };
  teamName: string;
  displayStats: StatDefinition[];
  showAllStats: boolean;
  saving: boolean;
  captureNotice: string;
  onCapture: (kind: 'photo' | 'video', file?: File) => void;
  onGameChange: (game: GameSession) => void;
  onToggleShowAllStats: () => void;
  onLeaveGame: () => void;
  onEndGame: () => void;
};

function latestYardEventIds(game: GameSession) {
  if (game.sport !== 'football' || game.trackYards !== true) return {};
  return game.events.reduce<Record<string, string>>((eventIds, event) => {
    if (getFootballYardMetricId(event.statId)) {
      const controlId = event.statId === 'pass-yard' || event.statId === 'reception'
        ? 'pass-reception'
        : event.statId;
      return { [controlId]: event.id };
    }
    return eventIds;
  }, {});
}

const footballPassReceptionStat: StatDefinition = {
  id: 'pass-reception',
  label: 'Pass + reception',
  shortLabel: 'PASS / REC',
  points: 0,
};

export function LiveTrackerGame({
  currentGame,
  rule,
  athleteName,
  athleteImageUrl,
  athleteImageCrop,
  teamName,
  displayStats,
  showAllStats,
  saving,
  captureNotice,
  onCapture,
  onGameChange,
  onToggleShowAllStats,
  onLeaveGame,
  onEndGame,
}: LiveTrackerGameProps) {
  const currentGameRef = useRef(currentGame);
  const [yardDrafts, setYardDrafts] = useState<Record<string, number>>({});
  const [activeYardEventIds, setActiveYardEventIds] = useState<Record<string, string>>(() => latestYardEventIds(currentGame));
  const [baseballHitAttribution, setBaseballHitAttribution] = useState<StatAttribution | null>(null);
  const [baseballPitchAttribution, setBaseballPitchAttribution] = useState<StatAttribution | null>(null);
  const updateCurrentGame = (next: GameSession | ((game: GameSession) => GameSession)) => {
    const resolved = typeof next === 'function' ? next(currentGameRef.current) : next;
    currentGameRef.current = resolved;
    onGameChange(resolved);
  };
  const eventLabel = (statId: string) => rule.stats.find((item) => item.id === statId)?.label ?? statId;
  const yardTrackingEnabled = currentGame.sport === 'football' && currentGame.trackYards === true;

  useEffect(() => {
    currentGameRef.current = currentGame;
  }, [currentGame]);

  useEffect(() => {
    setYardDrafts({});
    setActiveYardEventIds(latestYardEventIds(currentGame));
    setBaseballHitAttribution(null);
    setBaseballPitchAttribution(null);
  }, [currentGame.id]);

  const updateYardValue = (statId: string, value: number) => {
    const eventId = activeYardEventIds[statId];
    if (!eventId) return;
    const nextYards = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    setYardDrafts((current) => ({ ...current, [statId]: nextYards }));
    updateCurrentGame((game) => updateStatEventYards(game, eventId, nextYards));
  };

  const updateYardDraft = (statId: string, delta: number) => {
    const eventId = activeYardEventIds[statId];
    const event = eventId
      ? currentGameRef.current.events.find((item) => item.id === eventId)
      : undefined;
    if (!event) return;
    updateYardValue(statId, adjustYardValue(event.yards ?? 0, delta));
  };

  const setYardDraft = (statId: string, value: string) => {
    const parsed = Number.parseInt(value, 10);
    updateYardValue(statId, Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
  };

  const activateYardEvent = (controlId: string, eventId: string, yards: number) => {
    setActiveYardEventIds({ [controlId]: eventId });
    setYardDrafts({ [controlId]: yards });
  };

  const selectYardEvent = (event: GameSession['events'][number]) => {
    if (!getFootballYardMetricId(event.statId)) return;
    const controlId = currentGame.sport === 'football' && (event.statId === 'pass-yard' || event.statId === 'reception')
      ? 'pass-reception'
      : event.statId;
    activateYardEvent(controlId, event.id, event.yards ?? 0);
  };

  const recordStat = (item: StatDefinition, attribution: StatAttribution) => {
    if (currentGame.sport === 'baseball' && item.id === 'hit') {
      setBaseballHitAttribution((current) => current === attribution ? null : attribution);
      return;
    }
    if (currentGame.sport === 'baseball' && item.id === 'pitch') {
      setBaseballPitchAttribution((current) => current === attribution ? null : attribution);
      return;
    }
    const isCombinedPassReception = currentGame.sport === 'football' && item.id === 'pass-reception';
    const yardMetricId = yardTrackingEnabled
      ? (isCombinedPassReception ? 'pass-yard' : getFootballYardMetricId(item.id))
      : null;
    const nextGame = isCombinedPassReception
      ? addFootballPassReception(currentGameRef.current, new Date(), 0, attribution)
      : addStatEvent(currentGameRef.current, item.id, new Date(), 0, attribution);
    updateCurrentGame(nextGame);
    if (yardMetricId && nextGame.events.length > currentGame.events.length) {
      const eventId = nextGame.events.at(-1)?.id;
      if (eventId) {
        activateYardEvent(item.id, eventId, 0);
      }
    }
  };

  const recordBaseballHit = (statId: string) => {
    if (!baseballHitAttribution) return;
    updateCurrentGame((game) => addStatEvent(game, statId, new Date(), 0, baseballHitAttribution));
    setBaseballHitAttribution(null);
  };

  const recordBaseballPitch = (statId: string) => {
    if (!baseballPitchAttribution) return;
    updateCurrentGame((game) => addStatEvent(game, statId, new Date(), 0, baseballPitchAttribution));
    setBaseballPitchAttribution(null);
  };

  const athleteTargetName = athleteName || 'athlete';
  const athleteInitials = athleteTargetName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'A';

  const [athleteImageFailed, setAthleteImageFailed] = useState(false);
  useEffect(() => {
    setAthleteImageFailed(false);
  }, [athleteImageUrl]);
  const athleteImageX = Math.max(0, Math.min(100, athleteImageCrop?.x ?? 50));
  const athleteImageY = Math.max(0, Math.min(100, athleteImageCrop?.y ?? 50));
  const athleteImageZoom = Math.max(100, Math.min(250, athleteImageCrop?.zoom ?? 100));

  const handleMediaSelection = (kind: 'photo' | 'video', event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (typeof input.blur === 'function') input.blur();
    onCapture(kind, file);
  };

  return (
    <section data-testid="live-tracker-layout" className="grid gap-3 lg:grid-cols-[0.85fr_1.15fr] lg:gap-6">
      <div className="order-1 lg:col-start-1 lg:row-start-1">
        <div data-testid="live-tracker-scoreboard" className="relative min-w-0 border border-primary/40 border-t-2 border-t-accent bg-[#0B1F3A] p-3 text-white clip-angled-sm sm:p-6" aria-live="polite">
          <div className="flex min-w-0 items-center justify-between gap-3 pr-24 sm:pr-52"><span className="inline-flex shrink-0 items-center gap-2 bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground"><span className="h-2 w-2 animate-pulse bg-current" /> Live</span><span className="min-w-0 truncate text-right text-xs font-bold uppercase tracking-widest text-white/60">{formatDate(currentGame.date)}</span></div>
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
                  <button type="button" onClick={() => updateCurrentGame((game) => adjustScore(game, side, -1))} aria-label={`Subtract one from ${label}`} data-testid={`score-adjust-${side}-decrease`} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center border border-white/20 text-white hover:bg-white/10"><Minus className="h-4 w-4" /></button>
                  <button type="button" onClick={() => updateCurrentGame((game) => adjustScore(game, side, 1))} aria-label={`Add one to ${label}`} data-testid={`score-adjust-${side}-increase`} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center border border-white/20 text-white hover:bg-white/10"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-4 sm:mt-4">
            <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-widest text-white/45">Manual score adjustment</span>
            <span className="shrink-0 text-right font-display text-lg uppercase tracking-wide text-white/80 sm:text-xl">{rule.phaseLabel} {currentGame.period}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 sm:mt-7">
            <button type="button" onClick={() => onGameChange({ ...currentGame, status: currentGame.status === 'paused' ? 'live' : 'paused' })} data-testid="button-toggle-live-game-pause" className="border border-white/20 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 sm:px-4 sm:py-3">{currentGame.status === 'paused' ? 'Resume' : 'Pause'}</button>
            <button type="button" onClick={() => onGameChange({ ...currentGame, period: currentGame.period + 1 })} className="border border-white/20 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 sm:px-4 sm:py-3">Next {rule.phaseLabel}</button>
          </div>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 sm:right-5 sm:top-5" data-testid="live-tracker-capture-controls">
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 border border-white/20 bg-white/5 px-2.5 py-2 text-[10px] font-bold uppercase tracking-widest text-white/75 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary focus-within:border-primary focus-within:text-primary sm:min-h-11 sm:px-3" data-testid="label-stat-tracker-capture-photo">
              <Camera className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Take a photo</span>
              <span className="sr-only sm:hidden">Take a photo</span>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => handleMediaSelection('photo', event)} aria-label="Take a photo of this game" data-testid="input-stat-tracker-capture-photo" />
            </label>
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 border border-white/20 bg-white/5 px-2.5 py-2 text-[10px] font-bold uppercase tracking-widest text-white/75 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary focus-within:border-primary focus-within:text-primary sm:min-h-11 sm:px-3" data-testid="label-stat-tracker-capture-video">
              <Video className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Record a video</span>
              <span className="sr-only sm:hidden">Record a video</span>
              <input type="file" accept="video/*" capture="environment" className="sr-only" onChange={(event) => handleMediaSelection('video', event)} aria-label="Record a video of this game" data-testid="input-stat-tracker-capture-video" />
            </label>
          </div>
          {captureNotice && <p className="mt-3 truncate text-[10px] font-bold uppercase tracking-widest text-primary" role="status" data-testid="status-stat-tracker-capture-notice">{captureNotice}</p>}
        </div>
      </div>
      <div data-testid="live-tracker-stat-controls" className="order-2 min-w-0 border border-border bg-card p-4 clip-angled-sm sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="mb-5 flex min-w-0 items-end justify-between gap-4"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-widest text-accent">Tap a stat</p><h2 className="mt-1 break-words font-display text-3xl uppercase tracking-wide">{athleteName || 'Athlete'}</h2></div><span className="shrink-0 text-right text-xs font-bold uppercase tracking-widest text-muted-foreground">Count / points<br /><strong className="whitespace-nowrap text-foreground">{Object.values(currentGame.stats).reduce((sum, count) => sum + count, 0)} plays / {currentGame.score} pts</strong></span></div>
        {currentGame.sport === 'football' && (
          <div className="mb-5 border border-primary/30 bg-primary/5 p-3" data-testid="football-yard-tracking">
            <label className="flex cursor-pointer items-start gap-3 text-xs font-bold uppercase tracking-widest text-foreground">
              <input
                type="checkbox"
                checked={yardTrackingEnabled}
                onChange={(event) => updateCurrentGame({ ...currentGame, trackYards: event.currentTarget.checked })}
                data-testid="toggle-football-yard-tracking"
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Track yards for this game
                <span className="mt-1 block text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                  {yardTrackingEnabled ? 'Tap a pass, rush, or reception first, then enter yards for that recorded play.' : 'Play counts stay one tap each; yard entry is off.'}
                </span>
              </span>
            </label>
          </div>
        )}
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
          {(currentGame.sport === 'football'
            ? displayStats.filter((item) => item.id !== 'reception').map((item) => item.id === 'pass-yard' ? footballPassReceptionStat : item)
            : displayStats
          ).map((item) => {
            const isCombinedPassReception = currentGame.sport === 'football' && item.id === 'pass-reception';
            const yardMetricId = currentGame.sport === 'football'
              ? (isCombinedPassReception ? 'pass-yard' : getFootballYardMetricId(item.id))
              : null;
            const yardTotal = yardMetricId ? currentGame.yardStats?.[yardMetricId] ?? 0 : 0;
            const receivingYardTotal = isCombinedPassReception ? currentGame.yardStats?.['receiving-yard'] ?? 0 : 0;
            const yardSummary = isCombinedPassReception && yardTotal !== receivingYardTotal
              ? `Pass ${yardTotal} · Rec ${receivingYardTotal} yds`
              : isCombinedPassReception
                ? `${yardTotal} yds each`
                : `${yardTotal} yds`;
            const statCount = isCombinedPassReception
              ? Math.max(currentGame.stats['pass-yard'] ?? 0, currentGame.stats.reception ?? 0)
              : currentGame.sport === 'baseball' && item.id === 'hit'
                ? (currentGame.stats.hit ?? 0) + baseballHitChoices.reduce((total, choice) => total + (currentGame.stats[choice.id] ?? 0), 0)
                : currentGame.sport === 'baseball' && item.id === 'pitch'
                  ? (currentGame.stats.pitch ?? 0) + baseballPitchChoices.reduce((total, choice) => total + (currentGame.stats[choice.id] ?? 0), 0)
                  : currentGame.stats[item.id] ?? 0;
            const activeYardEventId = yardMetricId ? activeYardEventIds[item.id] : undefined;
            const activeYardEvent = activeYardEventId
              ? currentGame.events.find((event) => event.id === activeYardEventId)
              : undefined;
            const yardControlEnabled = yardTrackingEnabled && Boolean(activeYardEvent);
            const yardDraft = yardControlEnabled
              ? yardDrafts[item.id] ?? activeYardEvent?.yards ?? 0
              : 0;
            const attributedStatIds = currentGame.sport === 'baseball' && item.id === 'hit'
              ? ['hit', ...baseballHitChoices.map((choice) => choice.id)]
              : currentGame.sport === 'baseball' && item.id === 'pitch'
                ? ['pitch', ...baseballPitchChoices.map((choice) => choice.id)]
                : isCombinedPassReception
                  ? ['pass-yard', 'reception']
                : item.id;
            const rawAttributedCounts = countStatEventsByAttribution(currentGame, attributedStatIds);
            const attributedCounts = isCombinedPassReception
              ? {
                team: Math.ceil(rawAttributedCounts.team / 2),
                athlete: Math.ceil(rawAttributedCounts.athlete / 2),
              }
              : rawAttributedCounts;
            const athleteAssigned = attributedCounts.athlete > 0;
            const athleteAssignmentDescriptionId = `athlete-assignment-${item.id}`;
            const choicesAttribution = item.id === 'hit' ? baseballHitAttribution : baseballPitchAttribution;
            return (
              <div key={item.id} data-testid={`live-stat-card-${item.id}`} data-athlete-assigned={athleteAssigned ? 'true' : 'false'} className="relative min-w-0 overflow-hidden border border-border bg-background p-3 transition-colors hover:border-primary hover:bg-primary/5">
                <button type="button" data-testid={`live-stat-${item.id}`} onClick={() => recordStat(item, 'team')} aria-label={`Record ${item.label} for ${teamName || 'team'}`} aria-describedby={athleteAssigned ? athleteAssignmentDescriptionId : undefined} aria-expanded={currentGame.sport === 'baseball' && (item.id === 'hit' || item.id === 'pitch') ? Boolean(choicesAttribution) : undefined} className="group block min-h-[76px] w-full min-w-0 overflow-hidden pr-12 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <span className="block truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground group-hover:text-primary-ink">{item.label}</span>
                  <span className="mt-2 block truncate font-display text-2xl uppercase">{item.shortLabel}</span>
                  <span className="mt-1 block truncate text-xs font-bold text-primary-ink">
                    {statCount}
                    {item.points ? ` · +${item.points}` : yardMetricId ? ` · ${yardSummary}` : ' · tracked'}
                  </span>
                  <span className="mt-1 block truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Team {attributedCounts.team} · {athleteTargetName} {attributedCounts.athlete}</span>
                </button>
                <button
                  type="button"
                  onClick={() => recordStat(item, 'athlete')}
                  aria-label={`Record ${item.label} for ${athleteTargetName}`}
                  aria-describedby={athleteAssigned ? athleteAssignmentDescriptionId : undefined}
                  aria-expanded={currentGame.sport === 'baseball' && (item.id === 'hit' || item.id === 'pitch') ? choicesAttribution === 'athlete' : undefined}
                  data-testid={`athlete-stat-target-${item.id}`}
                  className="absolute right-2 top-2 flex min-h-11 min-w-11 items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-primary/10 text-[10px] font-black uppercase text-primary-ink shadow-sm hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {athleteImageUrl && !athleteImageFailed
                    ? (
                      <span className="relative block h-10 w-10 overflow-hidden rounded-full" aria-hidden="true">
                        <img
                          src={athleteImageUrl}
                          alt=""
                          onError={() => setAthleteImageFailed(true)}
                          className="absolute inset-0 block h-full w-full max-w-none object-cover"
                          style={{
                            objectPosition: `${athleteImageX}% ${athleteImageY}%`,
                            transform: `scale(${athleteImageZoom / 100})`,
                            transformOrigin: `${athleteImageX}% ${athleteImageY}%`,
                          }}
                        />
                      </span>
                    )
                    : <span aria-hidden="true" className="truncate">{athleteInitials}</span>}
                </button>
                {athleteAssigned && <span id={athleteAssignmentDescriptionId} className="sr-only">{athleteTargetName} is assigned to this stat.</span>}
                {currentGame.sport === 'baseball' && item.id === 'hit' && baseballHitAttribution && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border/70 pt-3" data-testid="baseball-hit-choices">
                    {baseballHitChoices.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => recordBaseballHit(choice.id)}
                        data-testid={`baseball-hit-${choice.id}`}
                        className="min-h-10 border border-primary/30 bg-primary/5 px-1.5 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-foreground hover:border-primary hover:bg-primary/15"
                      >
                        <span className="block font-display text-lg text-primary-ink">{choice.shortLabel}</span>
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
                {currentGame.sport === 'baseball' && item.id === 'pitch' && baseballPitchAttribution && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border/70 pt-3" data-testid="baseball-pitch-choices">
                    {baseballPitchChoices.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => recordBaseballPitch(choice.id)}
                        data-testid={`baseball-pitch-${choice.id}`}
                        className="min-h-10 border border-primary/30 bg-primary/5 px-1.5 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-foreground hover:border-primary hover:bg-primary/15"
                      >
                        <span className="block font-display text-lg text-primary-ink">{choice.shortLabel}</span>
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
                {yardMetricId && (
                  <div className={`mt-3 border-t border-border/70 pt-3 ${yardControlEnabled ? '' : 'opacity-50'}`} data-testid={`yard-control-${item.id}`} aria-disabled={!yardControlEnabled}>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground" htmlFor={`yard-input-${item.id}`}>
                      {yardControlEnabled ? 'Yards for recorded play' : 'Yards locked until play is recorded'}
                    </label>
                    {yardTrackingEnabled ? (
                      <div className="mt-2 flex items-center gap-1.5">
                        <button type="button" disabled={!yardControlEnabled} onClick={() => updateYardDraft(item.id, -1)} aria-label={`Decrease ${item.label} yards by one`} data-testid={`yard-adjust-${item.id}-decrease`} className="flex min-h-10 min-w-10 shrink-0 items-center justify-center border border-border text-foreground hover:border-primary hover:text-primary-ink disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"><Minus className="h-4 w-4" /></button>
                        <input
                          id={`yard-input-${item.id}`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={yardDraft}
                          disabled={!yardControlEnabled}
                          onChange={(event) => setYardDraft(item.id, event.currentTarget.value)}
                          onWheel={(event) => {
                            event.preventDefault();
                            updateYardDraft(item.id, event.deltaY < 0 ? 5 : -1);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowUp') {
                              event.preventDefault();
                              updateYardDraft(item.id, 5);
                            } else if (event.key === 'ArrowDown') {
                              event.preventDefault();
                              updateYardDraft(item.id, -1);
                            } else if (event.key === 'Enter') {
                              event.preventDefault();
                            }
                          }}
                          aria-disabled={!yardControlEnabled}
                          aria-label={`${item.label} yards for recorded play`}
                          aria-valuemin={0}
                          aria-valuenow={yardDraft}
                          data-testid={`input-yard-${item.id}`}
                          className="min-w-0 flex-1 border border-border bg-background px-2 py-2 text-center text-sm font-bold text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                        />
                        <button type="button" disabled={!yardControlEnabled} onClick={() => updateYardDraft(item.id, 5)} aria-label={`Increase ${item.label} yards by five`} data-testid={`yard-adjust-${item.id}-increase`} className="flex min-h-10 min-w-10 shrink-0 items-center justify-center border border-border text-foreground hover:border-primary hover:text-primary-ink disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"><Plus className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <p className="mt-2 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">Yard entry is off for this game.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={onToggleShowAllStats} className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">{showAllStats ? 'Show featured stats' : 'Show more stats'} <ChevronDown className={`h-4 w-4 transition-transform ${showAllStats ? 'rotate-180' : ''}`} /></button>
        <label className="mt-7 block border-t border-border pt-5 text-xs font-bold uppercase tracking-widest text-muted-foreground"><span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-primary-ink" /> Game notes</span>
          <textarea value={currentGame.notes} onChange={(event) => onGameChange({ ...currentGame, notes: event.target.value })} placeholder="Add a note to look back on later." rows={4} className="mt-2 w-full resize-y border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary" />
        </label>
        <div className="mt-7 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:justify-between">
          <button type="button" onClick={onLeaveGame} className="inline-flex min-h-12 items-center justify-center gap-2 border border-border px-5 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"><Minus className="h-4 w-4" /> Leave game open</button>
          <button type="button" disabled={saving} onClick={onEndGame} data-testid="button-end-live-game" className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110 disabled:opacity-50"><CircleStop className="h-4 w-4" /> {saving ? 'Saving…' : 'End & save game'}</button>
        </div>
      </div>
      <div data-testid="live-tracker-recent-activity" className="order-3 border border-border bg-card p-4 clip-angled-sm sm:p-5 lg:col-start-1 lg:row-start-2">
        <div className="mb-4 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-widest text-primary-ink">Recent activity</p><History className="h-4 w-4 text-muted-foreground" /></div>
        <div className="space-y-2">
          {currentGame.events.slice(-5).reverse().map((event) => {
            const yardMetricId = currentGame.sport === 'football' ? getFootballYardMetricId(event.statId) : null;
            const isSelectedYardEvent = activeYardEventIds[event.statId] === event.id;
            const nextAttribution: StatAttribution = event.attribution === 'athlete' ? 'team' : 'athlete';
            const nextAttributionLabel = nextAttribution === 'athlete' ? athleteTargetName : (teamName || 'team');
            return (
              <div key={event.id} className={`border-b pb-2 text-sm ${isSelectedYardEvent ? 'border-primary/60 bg-primary/5 px-2 pt-2' : 'border-border/60'}`} data-testid={`recent-activity-${event.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{eventLabel(event.statId)}{yardMetricId ? ` · ${event.yards ?? 0} yds` : ''} <span className="text-xs font-bold uppercase text-primary-ink">· {event.attribution === 'athlete' ? athleteTargetName : 'Team'}</span></span>
                  <span className="shrink-0 text-xs text-muted-foreground">{rule.phaseLabel} {event.period} · {formatEventTime(event.createdAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateCurrentGame((game) => updateStatEventAttribution(game, event.id, nextAttribution))}
                    aria-label={`Change ${eventLabel(event.statId)} attribution to ${nextAttributionLabel}`}
                    data-testid={`button-correct-attribution-${event.id}`}
                    className="inline-flex min-h-11 items-center border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-primary-ink hover:border-primary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Move to {nextAttribution === 'athlete' ? athleteTargetName : 'team'}
                  </button>
                  {yardMetricId && yardTrackingEnabled && (
                    <button
                      type="button"
                      onClick={() => selectYardEvent(event)}
                      aria-pressed={isSelectedYardEvent}
                      data-testid={`button-correct-yards-${event.id}`}
                      className="inline-flex min-h-11 items-center border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-primary-ink hover:border-primary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {isSelectedYardEvent ? 'Editing this play' : 'Correct yards'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
  const selectedScheduleEventId = searchParams.get('eventId');
  const localSelectedGame = useMemo(
    () => getSelectedScheduledGame(readScheduleDraft()?.events, selectedScheduleEventId),
    [selectedScheduleEventId],
  );
  const [sport, setSport] = useState<Sport>(profile.sport ?? 'basketball');
  const [storageAccountId, setStorageAccountId] = useState<string | null>(null);
  const [data, setData] = useState<StatTrackerData>(() => normalizeTrackerData(null));
  const [currentGame, setCurrentGame] = useState<GameSession | null>(null);
  const [date, setDate] = useState(searchParams.get('date') ?? localNextGame?.date ?? new Date().toISOString().slice(0, 10));
  const [opponent, setOpponent] = useState(searchParams.get('opponent') ?? localNextGame?.opponent ?? '');
  const [notes, setNotes] = useState('');
  const [captureNotice, setCaptureNotice] = useState('');
  const [notice, setNotice] = useState('');
  const [showUpcomingNotice, setShowUpcomingNotice] = useState(false);
  const [showManualSetup, setShowManualSetup] = useState(false);
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<TrackerSaveStatus | null>(null);
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
  const setupSectionRef = useRef<HTMLElement | null>(null);
  const historySectionRef = useRef<HTMLElement | null>(null);
  const upcomingNoticeGameId = useRef<string | null>(null);
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
  const { data: athletePortrait } = useGetSupporterPhoto({
    query: {
      enabled: Boolean(accountId),
      retry: false,
      queryKey: [...getGetSupporterPhotoQueryKey(), accountId],
    },
  });
  const { data: projects } = useListProjects({
    query: {
      enabled: Boolean(accountId && accountAccess),
      queryKey: [...getListProjectsQueryKey(), accountId],
    },
  });
  const { data: trackerShares } = useListStatTrackerShares({
    query: {
      enabled: Boolean(accountId && accountAccess && currentGame),
      staleTime: 10000,
      queryKey: getListStatTrackerSharesQueryKey(),
    },
  });
  const createTrackerShare = useCreateStatTrackerShare();
  const updateTrackerShare = useUpdateStatTrackerShare();
  const deleteTrackerShare = useDeleteStatTrackerShare();
  const [shareNotice, setShareNotice] = useState('');
  const [shareError, setShareError] = useState('');
  const shareUpdateTimer = useRef<number | null>(null);
  const shareUpdateQueue = useRef(Promise.resolve());

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
  const ownedScheduleSelectedGame = useMemo(
    () => getSelectedScheduledGame(ownedSchedule?.events, selectedScheduleEventId),
    [ownedSchedule?.events, selectedScheduleEventId],
  );
  const activeTrackerShare = useMemo(
    () => (currentGame ? trackerShares?.find((share) => share.game.id === currentGame.id) ?? null : null),
    [currentGame, trackerShares],
  );
  const shareUrl = activeTrackerShare
    ? `${trackerAppOrigin}${trackerBasePath}/live/${encodeURIComponent(activeTrackerShare.shareToken)}`
    : '';
  const publishTrackerShare = (game: GameSession, share: StatTrackerShare | null | undefined = activeTrackerShare): Promise<void> => {
    if (!share) return Promise.resolve();
    const input = toStatTrackerShareInput(game, profile.athleteName, profile.teamName);
    shareUpdateQueue.current = shareUpdateQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const updated = await updateTrackerShare.mutateAsync({
            shareToken: share.shareToken,
            data: { ...input, expectedRevision: share.revision },
          });
          await queryClient.invalidateQueries({ queryKey: getListStatTrackerSharesQueryKey() });
          setShareError('');
          setShareNotice(updated.revision === share.revision ? '' : 'Live link updated');
        } catch {
          await queryClient.invalidateQueries({ queryKey: getListStatTrackerSharesQueryKey() });
          const latest = queryClient.getQueryData<StatTrackerShare[]>(getListStatTrackerSharesQueryKey())
            ?.find((item) => item.shareToken === share.shareToken);
          if (latest && latest.revision !== share.revision) {
            try {
              await updateTrackerShare.mutateAsync({
                shareToken: latest.shareToken,
                data: { ...input, expectedRevision: latest.revision },
              });
              setShareError('');
              return;
            } catch {
              // The bounded retry below reports the durable failure.
            }
          }
          setShareError('Private game is safe, but the supporter link could not sync. Try again.');
        }
      });
    return shareUpdateQueue.current;
  };

  useEffect(() => {
    if (!currentGame || !activeTrackerShare || createTrackerShare.isPending) return;
    if (shareUpdateTimer.current) window.clearTimeout(shareUpdateTimer.current);
    shareUpdateTimer.current = window.setTimeout(() => publishTrackerShare(currentGame), 450);
    return () => {
      if (shareUpdateTimer.current) window.clearTimeout(shareUpdateTimer.current);
    };
  }, [currentGame, activeTrackerShare?.shareToken]);

  useEffect(() => {
    initializedCloud.current = false;
    setCloudProject(null);
    setStorageAccountId(null);
    setTrackerConflict(null);
    setSelectedConflictResolution(null);
    setSaveStatus(null);
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
    saveStoredActiveGame(window.localStorage, accountId, currentGame);
  }, [accountId, currentGame, storageAccountId]);

  const rule = getSportRule(sport);
  const totals = seasonTotals(data.games, sport);
  const yardTotals = seasonYardTotals(data.games, sport);
  const displayStats = rule.stats.filter((item) => !item.liveHidden && (showAllStats || item.featured));
  const nextGame = ownedScheduleSelectedGame
    ?? localSelectedGame
    ?? ownedScheduleNextGame
    ?? localNextGame;
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

  useEffect(() => {
    if (!nextGame) {
      upcomingNoticeGameId.current = null;
      setShowUpcomingNotice(false);
      return;
    }
    if (!manuallyEditedSetup.current.date) setDate(nextGame.date);
    if (!manuallyEditedSetup.current.opponent) setOpponent(nextGame.opponent);
    if (upcomingNoticeGameId.current !== nextGame.id) {
      upcomingNoticeGameId.current = nextGame.id;
      setShowUpcomingNotice(true);
    }
  }, [nextGame]);
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };

  const handleCapture = (kind: 'photo' | 'video', file?: File) => {
    if (!file) {
      setCaptureNotice('No media selected. You can try again whenever you are ready.');
      return;
    }
    const captureOpponent = currentGame?.opponent ?? opponent;
    const gameTitle = captureOpponent ? `${profile.teamName || 'Your team'} vs ${captureOpponent}` : 'this game';
    setCaptureNotice(
      `${kind === 'photo' ? 'Photo' : 'Video'} ready for ${gameTitle}. It stays in your camera roll; Pixl Sports does not upload or store it here.`,
    );
  };

  const updateOwnedScheduledGameStatus = (
    scheduledGame: ScheduledGame | undefined,
    status: ScheduleEventStatus,
    completedAt?: string,
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
          completedAt,
           canWrite: profile.role === 'fan',
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
    setSaveStatus(null);
    activeScheduledGame.current = nextGame
      && nextGame.date === date
      && nextGame.opponent === opponent
      ? nextGame
      : undefined;
    setCurrentGame(createGameSession(sport, { date, opponent, notes }));
    setShowUpcomingNotice(false);
    updateOwnedScheduledGameStatus(activeScheduledGame.current, 'live');
    announce('GAME STARTED — LIVE STATS ARE READY');
  };

  const useNextGameForSetup = () => {
    if (!nextGame) return;
    manuallyEditedSetup.current.date = true;
    manuallyEditedSetup.current.opponent = true;
    setDate(nextGame.date);
    setOpponent(nextGame.opponent);
    setShowUpcomingNotice(false);
    setShowAdvancedSetup(false);
    setShowManualSetup(false);
    setupSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      setupSectionRef.current?.querySelector<HTMLInputElement>('[data-testid="input-athlete-result-date"]')?.focus();
    }, 350);
  };

  const reviewPreviousGames = () => {
    historySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => historySectionRef.current?.focus(), 350);
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

  const persistCompletedGame = async (completed: GameSession, share: StatTrackerShare | null = null) => {
    if (shareUpdateTimer.current) {
      window.clearTimeout(shareUpdateTimer.current);
      shareUpdateTimer.current = null;
    }
    await publishTrackerShare(completed, share ?? undefined);
    updateOwnedScheduledGameStatus(activeScheduledGame.current, 'final', completed.endedAt);
    const nextData = { ...data, games: [...data.games, completed] };
    setData(nextData);
    setCurrentGame(null);
    setSaving(true);
    setSaveStatus('saving');
    setError('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    setTrackerConflict(null);
    setSelectedConflictResolution(null);
    try {
      await syncTrackerData(nextData);
      if (accountId) clearStoredTrackerConflict(window.localStorage, accountId);
      trackTrackerSyncOutcome('cloud_success', 'initial_save', completed.sport);
      setSaveStatus('cloud-saved');
      announce('GAME SAVED — SEASON TOTALS UPDATED');
    } catch (saveError: any) {
      const recovery = getTrackerSyncRecovery(saveError);
      const conflict = getTrackerConflict(saveError, nextData);
      trackTrackerSyncOutcome(
        recovery.revisionConflict ? 'revision_conflict' : 'local_only_failure',
        'initial_save',
        completed.sport,
      );
      setError(recovery.message);
      setRevisionConflict(recovery.revisionConflict);
      setRetryAvailable(recovery.retryAvailable);
      setTrackerConflict(conflict);
      setSaveStatus('local-saved');
      announce('LOCAL COPY SAVED — CLOUD SYNC NEEDS ATTENTION');
    } finally {
      setSaving(false);
    }
  };

  const saveCompletedGame = async () => {
    if (!currentGame) return;
    await persistCompletedGame(endGame(currentGame), activeTrackerShare);
  };

  const saveAthleteResult = async (capture: AthleteResultCapture) => {
    if (saving) return;
    setError('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    setTrackerConflict(null);
    setSelectedConflictResolution(null);
    setSaveStatus(null);
    activeScheduledGame.current = nextGame
      && nextGame.date === capture.date
      && nextGame.opponent === capture.opponent
      ? nextGame
      : undefined;
    try {
      const completed = createAthleteResultGame(sport, capture);
      await persistCompletedGame(completed);
      setNotes('');
      setShowUpcomingNotice(false);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Could not save this result.');
    }
  };

  const retryCloudSync = async () => {
    if (saving || !retryAvailable) return;
    setSaving(true);
    setSaveStatus('saving');
    setError('');
    try {
      await syncTrackerData(data);
      if (accountId) clearStoredTrackerConflict(window.localStorage, accountId);
      trackTrackerSyncOutcome('retry_success', 'retry', sport);
      setRetryAvailable(false);
      setRevisionConflict(false);
      setTrackerConflict(null);
      setSelectedConflictResolution(null);
      setSaveStatus('cloud-saved');
      announce('CLOUD SYNC RESTORED — SEASON HISTORY IS SAFE');
    } catch (saveError: any) {
      const recovery = getTrackerSyncRecovery(saveError);
      const conflict = getTrackerConflict(saveError, data);
      trackTrackerSyncOutcome(
        recovery.revisionConflict ? 'revision_conflict' : 'local_only_failure',
        'retry',
        sport,
      );
      setError(recovery.message);
      setRevisionConflict(recovery.revisionConflict);
      setRetryAvailable(recovery.retryAvailable);
      setTrackerConflict(conflict ?? trackerConflict);
      setSaveStatus('local-saved');
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
    setSaveStatus('saving');
    setError('');
    setRetryAvailable(false);
    const selectedData = data;
    try {
      await syncTrackerData(selectedData);
      if (accountId) clearStoredTrackerConflict(window.localStorage, accountId);
      trackTrackerSyncOutcome('retry_success', 'conflict_resolution', sport);
      setRevisionConflict(false);
      setTrackerConflict(null);
      setSelectedConflictResolution(null);
      setSaveStatus('cloud-saved');
      announce('HISTORY RESOLVED — CLOUD SYNC RESTORED');
    } catch (saveError: any) {
      const recovery = getTrackerSyncRecovery(saveError);
      const nextConflict = getTrackerConflict(saveError, selectedData);
      trackTrackerSyncOutcome(
        recovery.revisionConflict ? 'revision_conflict' : 'local_only_failure',
        'conflict_resolution',
        sport,
      );
      setError(recovery.message);
      setRevisionConflict(recovery.revisionConflict);
      setRetryAvailable(recovery.retryAvailable);
      setTrackerConflict(nextConflict ?? { ...trackerConflict, localData: selectedData });
      setSaveStatus('local-saved');
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

  const createSupporterLink = async () => {
    if (!currentGame) return;
    setShareError('');
    setShareNotice('');
    try {
      await createTrackerShare.mutateAsync({
        data: toStatTrackerShareInput(currentGame, profile.athleteName, profile.teamName),
      });
      await queryClient.invalidateQueries({ queryKey: getListStatTrackerSharesQueryKey() });
      setShareNotice('Link ready — copy it for supporters.');
    } catch {
      setShareError('Could not create the supporter link. Your private tracker is unchanged.');
    }
  };

  const revokeSupporterLink = async () => {
    if (!activeTrackerShare) return;
    setShareError('');
    try {
      await deleteTrackerShare.mutateAsync({ shareToken: activeTrackerShare.shareToken });
      await queryClient.invalidateQueries({ queryKey: getListStatTrackerSharesQueryKey() });
      setShareNotice('Supporter link revoked.');
    } catch {
      setShareError('Could not revoke the supporter link. Try again.');
    }
  };

  const copySupporterLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareNotice('Link copied.');
    } catch {
      setShareNotice('Clipboard unavailable — select the link above to copy it.');
    }
  };

  return (
    <div className="studio-editor-page-background stat-tracker-editor-page min-h-dvh">
      <div className="pixl-editor-main mx-auto w-full max-w-[1400px] px-5 py-6 sm:px-8 lg:py-10">
      <div className="pixl-editor-header mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/studio" className="mb-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Game Day Hub
          </Link>
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Athlete game log</p>
          <h1 className="mt-2 font-display text-5xl uppercase tracking-tight sm:text-7xl">ATHLETE <span className="text-primary-ink studio-textured-heading-accent">STATS.</span></h1>
          <p className="mt-3 max-w-2xl text-sm font-medium text-muted-foreground sm:text-base">Save the result, optional athlete stats, and the moments you want to remember. Use Advanced team stats when you want live play-by-play.</p>
        </div>
        {saveStatus && <StatTrackerSaveStatus status={saveStatus} />}
      </div>

      <div className="pixl-editor-tabs mb-6 flex gap-2 overflow-x-auto border-b border-border pb-1" role="tablist" aria-label="Choose athlete sport">
        {(profile.sport ? [profile.sport] : sports).map((option) => (
          <button key={option} type="button" role="tab" aria-selected={sport === option} onClick={() => !currentGame && setSport(option)} disabled={Boolean(currentGame)} className={`shrink-0 border-b-4 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed ${sport === option ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {getSportRule(option).label}
          </button>
        ))}
      </div>

      {nextGame && !currentGame && (
        <StatTrackerUpcomingNotice
          nextGame={nextGame}
          onUseUpcomingGame={useNextGameForSetup}
          onDismiss={() => setShowUpcomingNotice(false)}
          onToggleManualSetup={() => {
            setShowAdvancedSetup(true);
            setShowManualSetup((value) => !value);
          }}
          showManualSetup={showManualSetup}
          hiddenOnDesktop={!showUpcomingNotice}
        />
      )}

      <StatTrackerSaveRecoveryAlert
        message={error}
        retryAvailable={retryAvailable}
        revisionConflict={revisionConflict}
        hasConflict={Boolean(trackerConflict)}
        saving={saving}
        onRetry={() => void retryCloudSync()}
        onRefresh={() => window.location.reload()}
      />

      {revisionConflict && trackerConflict && (
        <section className="mb-6 border border-primary/50 bg-card p-5 clip-angled-sm sm:p-7" aria-labelledby="tracker-conflict-heading" data-testid="stat-tracker-conflict">
          <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-accent">History needs a choice</p>
              <h2 id="tracker-conflict-heading" className="mt-1 font-display text-3xl uppercase tracking-wide">Newer cloud copy found</h2>
              <p className="mt-2 max-w-3xl text-sm font-medium text-muted-foreground">Your local history is preserved. Choose a copy or merge games that only exist in one history, then sync the selected result without leaving this page.</p>
            </div>
            <GitMerge className="hidden h-7 w-7 shrink-0 text-primary-ink sm:block" />
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
        <section ref={setupSectionRef} className="grid scroll-mt-6 gap-6 lg:grid-cols-[1.2fr_0.8fr]" data-testid="stat-tracker-setup">
          <div className="space-y-5">
            <AthleteResultPanel
              athleteName={profile.athleteName}
              teamName={profile.teamName}
              rule={rule}
              date={date}
              opponent={opponent}
              notes={notes}
              saving={saving}
              onDateChange={(value) => { manuallyEditedSetup.current.date = true; setDate(value); }}
              onOpponentChange={(value) => { manuallyEditedSetup.current.opponent = true; setOpponent(value); }}
              onNotesChange={setNotes}
              onSave={(capture) => void saveAthleteResult(capture)}
              onOpenAdvanced={() => {
                setShowAdvancedSetup(true);
                setShowManualSetup(true);
              }}
            />
            {showAdvancedSetup && (
              <div data-testid="advanced-team-stats-setup">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-accent">Advanced team stats</p>
                    <p className="mt-1 text-sm font-medium text-muted-foreground">Use the full live scoreboard, play-by-play, team attribution, and supporter link.</p>
                  </div>
                  <button type="button" onClick={() => { setShowAdvancedSetup(false); setShowManualSetup(false); }} className="inline-flex min-h-10 min-w-10 items-center justify-center border border-border text-muted-foreground hover:border-primary hover:text-foreground" aria-label="Close advanced team stats setup"><X className="h-4 w-4" /></button>
                </div>
                <StatTrackerStartPanel
                  label={rule.label}
                  date={date}
                  opponent={opponent}
                  notes={notes}
                  showManualSetup={showManualSetup}
                  onToggleManualSetup={() => setShowManualSetup((value) => !value)}
                  onDateChange={(value) => { manuallyEditedSetup.current.date = true; setDate(value); }}
                  onOpponentChange={(value) => { manuallyEditedSetup.current.opponent = true; setOpponent(value); }}
                  onNotesChange={setNotes}
                  onStartGame={beginGame}
                  onReviewPreviousGames={reviewPreviousGames}
                />
              </div>
            )}
          </div>
          <section className="border border-border bg-card p-6 text-card-foreground clip-angled-sm sm:p-8" data-testid="stat-tracker-season-snapshot">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Season snapshot</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="border border-border bg-background/40 p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Games</p><p className="mt-2 font-display text-4xl text-foreground">{totals.gamesPlayed}</p></div>
              <div className="border border-border bg-background/40 p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Points</p><p className="mt-2 font-display text-4xl text-primary">{totals.score}</p></div>
            </div>
            <div className="mt-7 space-y-3">
              {rule.stats.filter((item) => totals.stats[item.id]).slice(0, 5).map((item) => <div key={item.id} className="flex items-center justify-between border-b border-border pb-2 text-sm"><span className="font-bold uppercase tracking-wider text-muted-foreground">{item.label}</span><span className="font-display text-2xl text-foreground">{totals.stats[item.id]}</span></div>)}
              {sport === 'football' && footballYardMetricDefinitions
                .filter((metric) => yardTotals[metric.id])
                .map((metric) => <div key={metric.id} className="flex items-center justify-between border-b border-border pb-2 text-sm"><span className="font-bold uppercase tracking-wider text-muted-foreground">{metric.label}</span><span className="font-display text-2xl text-foreground">{yardTotals[metric.id]} <span className="text-xs text-muted-foreground">YDS</span></span></div>)}
              {!totals.gamesPlayed && <p className="text-sm text-muted-foreground">Finish your first game to build the season view.</p>}
            </div>
          </section>
        </section>
      ) : (
        <>
        <StatTrackerSharePanel
          share={activeTrackerShare}
          shareUrl={shareUrl}
          game={currentGame}
          athleteName={profile.athleteName}
          teamName={profile.teamName}
          busy={createTrackerShare.isPending || deleteTrackerShare.isPending || updateTrackerShare.isPending}
          error={shareError}
          notice={shareNotice}
          onCreate={() => void createSupporterLink()}
          onRevoke={() => void revokeSupporterLink()}
          onCopy={() => void copySupporterLink()}
        />
        <LiveTrackerGame
          currentGame={currentGame}
          rule={rule}
          athleteName={profile.athleteName}
          athleteImageUrl={athletePortrait ? `${athletePortrait.url}?v=${encodeURIComponent(String(athletePortrait.updatedAt))}` : undefined}
          athleteImageCrop={athletePortrait ? {
            x: athletePortrait.cropX,
            y: athletePortrait.cropY,
            zoom: athletePortrait.cropZoom,
          } : undefined}
          teamName={profile.teamName}
          displayStats={displayStats}
          showAllStats={showAllStats}
          saving={saving}
           captureNotice={captureNotice}
           onCapture={handleCapture}
           onGameChange={(next) => { setCurrentGame(next); announce('STAT UPDATED'); }}
          onToggleShowAllStats={() => setShowAllStats((value) => !value)}
          onLeaveGame={() => { setCurrentGame(null); setShowUpcomingNotice(false); }}
          onEndGame={() => void saveCompletedGame()}
        />
        </>
      )}

      <section ref={historySectionRef} id="tracker-game-history" tabIndex={-1} className="mt-10 scroll-mt-6 border border-border bg-card p-5 clip-angled-sm outline-none sm:p-7" data-testid="stat-tracker-history">
        <div className="mb-5 flex items-center justify-between border-b border-border pb-3"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Game history</p><h2 className="mt-1 font-display text-3xl uppercase tracking-wide">{rule.label} season</h2></div><Save className="h-5 w-5 text-muted-foreground" /></div>
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
    </div>
  );
}
