import React, { Component, lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { ArrowLeft, FileText, RotateCcw } from 'lucide-react';

import { countStatEventsByAttribution, footballYardMetricDefinitions, type GameReport, type SportRule } from './stat-tracker';

type ReportChartsProps = {
  report: GameReport;
  rule: SportRule;
  trendStats: SportRule['stats'];
  onSelectGame: (gameId: string) => void;
};

type ReportChartsLoader = () => Promise<{ default: ComponentType<ReportChartsProps> }>;

type ChartErrorBoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
};

type ChartErrorBoundaryState = {
  failed: boolean;
};

class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  state: ChartErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Report charts failed to load', error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="border border-destructive/50 bg-destructive/5 p-5 clip-angled-sm" data-testid="report-charts-error" role="alert">
          <p className="text-sm font-bold text-foreground">Charts couldn’t load.</p>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection, then try again. Your selected report is still open.</p>
          <button type="button" onClick={this.props.onRetry} data-testid="report-charts-retry" className="mt-4 inline-flex min-h-11 items-center gap-2 border border-border bg-card px-4 py-2 text-xs font-bold uppercase tracking-widest text-foreground hover:border-primary hover:text-primary-ink clip-angled-sm">
            <RotateCcw className="h-4 w-4" /> Retry charts
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function formatDate(value: string) {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function GameReportView({
  report,
  rule,
  onClose,
  onSelectGame,
  loadCharts = () => import('./stat-tracker-report-charts'),
  onRetryCharts,
}: {
  report: GameReport;
  rule: SportRule;
  onClose: () => void;
  onSelectGame: (gameId: string) => void;
  loadCharts?: ReportChartsLoader;
  onRetryCharts?: () => void;
}) {
  const { selectedGame, seasonToDate, averages, previousGame } = report;
  const isOneGame = report.games.length === 1;
  const hasStats = Object.values(selectedGame.stats).some((value) => value > 0);
  const [chartLoadAttempt, setChartLoadAttempt] = useState(0);
  const ReportCharts = useMemo(
    () => lazy(loadCharts),
    [chartLoadAttempt, loadCharts],
  );
  const retryCharts = () => {
    if (onRetryCharts) {
      onRetryCharts();
      setChartLoadAttempt((attempt) => attempt + 1);
      return;
    }
    window.location.reload();
  };

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const trendStats = useMemo(() => rule.stats
    .map((stat) => ({
      ...stat,
      seasonTotal: report.games.reduce((total, game) => total + (game.stats[stat.id] ?? 0), 0),
    }))
    .filter((stat) => stat.seasonTotal > 0)
    .sort((left, right) => right.seasonTotal - left.seasonTotal)
    .slice(0, 3), [report.games, rule.stats]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md" data-testid="game-report-overlay" role="dialog" aria-modal="true" aria-labelledby="game-report-title">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-5 py-4 backdrop-blur-md sm:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Game Report</p>
          <h2 id="game-report-title" className="font-display text-2xl uppercase tracking-wide">{selectedGame.opponent ? `vs ${selectedGame.opponent}` : 'Game'}</h2>
        </div>
        <button type="button" autoFocus onClick={onClose} data-testid="game-report-close" className="inline-flex min-h-11 items-center justify-center gap-2 border border-border bg-card px-4 py-2 text-xs font-bold uppercase tracking-widest text-foreground hover:bg-muted clip-angled-sm"><ArrowLeft className="h-4 w-4" /> Back to Tracker</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-[1200px] space-y-6 sm:space-y-8">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="border border-primary/40 bg-primary/5 p-5 clip-angled-sm" data-testid="report-score-box"><p className="text-[10px] font-bold uppercase tracking-widest text-primary-ink">Final Score</p><p className="mt-2 font-display text-5xl text-foreground sm:text-6xl">{selectedGame.score}<span className="text-muted-foreground">–</span><span className="text-muted-foreground">{selectedGame.opponentScore}</span></p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{formatDate(selectedGame.date)}</p></div>
            <div className="border border-border bg-card p-5 clip-angled-sm"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Season to Date (thru this game)</p><p className="mt-2 font-display text-4xl text-foreground sm:text-5xl">{seasonToDate.score} PTS</p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-primary-ink">{seasonToDate.gamesPlayed} GAMES</p></div>
            <div className="border border-border bg-card p-5 clip-angled-sm"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Season Average</p><p className="mt-2 font-display text-4xl text-foreground sm:text-5xl">{averages.score.toFixed(1)} <span className="text-xl">PTS/G</span></p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">OVER {seasonToDate.gamesPlayed} GAMES</p></div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
                <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Box Score</h3>
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">{rule.stats.map((stat) => {
                  const count = selectedGame.stats[stat.id] || 0;
                  const attribution = countStatEventsByAttribution(selectedGame, stat.id);
                  const previous = previousGame ? (previousGame.stats[stat.id] || 0) : 0;
                  const average = averages.stats[stat.id] || 0;
                  return <div key={stat.id} className="border border-border/50 bg-background p-3 clip-angled-sm" data-testid={`report-stat-${stat.id}`}><p className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{stat.label}</p><p className="mt-1 font-display text-3xl">{count}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground" data-testid={`report-attribution-${stat.id}`}>Team {attribution.team} · Athlete {attribution.athlete}</p><p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-primary-ink">Season: {seasonToDate.stats[stat.id] ?? 0}</p>{previousGame && <p className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${count > previous ? 'text-primary-ink' : count < previous ? 'text-destructive' : 'text-muted-foreground'}`}>{count > previous ? '+' : ''}{count - previous} vs last</p>}{!isOneGame && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Avg: {average.toFixed(1)}</p>}</div>;
                })}</div>
                {selectedGame.sport === 'football' && (
                  <div className="mt-6 border-t border-border pt-6" data-testid="report-yardage">
                    <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Yardage</h3>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      {footballYardMetricDefinitions.map((metric) => (
                        <div key={metric.id} className="border border-primary/20 bg-primary/5 p-3 clip-angled-sm" data-testid={`report-yard-${metric.id}`}>
                          <p className="truncate text-[10px] font-bold uppercase tracking-widest text-primary-ink">{metric.label}</p>
                          <p className="mt-1 font-display text-3xl">{selectedGame.yardStats?.[metric.id] ?? 0}</p>
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Game yards</p>
                          <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Season: {report.seasonToDateYards[metric.id] ?? 0}</p>
                          {!isOneGame && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Avg: {(averages.yards[metric.id] ?? 0).toFixed(1)}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!hasStats && <div className="mt-6 border border-border/50 bg-background p-6 text-center clip-angled-sm"><p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">No stats recorded for this game.</p></div>}
                {selectedGame.notes && <div className="mt-6 border-t border-border pt-4"><p className="text-[10px] font-bold uppercase tracking-widest text-primary-ink"><FileText className="mr-1 inline h-3 w-3" /> Game Notes</p><p className="mt-2 text-sm font-medium text-foreground">{selectedGame.notes}</p></div>}
              </div>

               {isOneGame ? (
                 <>
                   <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7"><h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Scoring Trend</h3><div className="mt-6 flex h-[200px] items-center justify-center border border-border/50 bg-background p-4 clip-angled-sm"><p className="text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">Play more games<br />to see trends.</p></div></div>
                   <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7"><h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Stat Trends</h3><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Game-to-game leaders for {rule.label}</p><div className="mt-6 flex h-[200px] items-center justify-center border border-border/50 bg-background p-4 clip-angled-sm"><p className="text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">Play more games<br />to compare stat trends.</p></div></div>
                 </>
               ) : (
                 <ChartErrorBoundary key={chartLoadAttempt} onRetry={retryCharts}>
                   <Suspense fallback={<div className="border border-border bg-card p-5 clip-angled-sm sm:p-7" data-testid="report-charts-loading" role="status" aria-live="polite"><p className="text-sm font-bold uppercase tracking-widest text-primary-ink">Loading charts…</p></div>}>
                     <ReportCharts report={report} rule={rule} trendStats={trendStats} onSelectGame={onSelectGame} />
                   </Suspense>
                 </ChartErrorBoundary>
               )}
            </div>

            <div className="border border-border bg-card p-5 clip-angled-sm"><h3 className="font-display text-xl uppercase tracking-wide text-foreground">Season Log</h3><div className="mt-5 space-y-2">{report.games.map((game, index) => <button type="button" key={game.id} onClick={() => onSelectGame(game.id)} data-testid={`history-nav-${game.id}`} className={`flex w-full items-center justify-between border p-3 text-left transition-colors clip-angled-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${game.id === selectedGame.id ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}><div className="min-w-0"><p className={`truncate font-display uppercase ${game.id === selectedGame.id ? 'text-primary-ink' : 'text-foreground'}`}>G{index + 1} <span className="ml-1 text-sm opacity-60">vs {game.opponent || 'TBD'}</span></p><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{formatDate(game.date)}</p></div><div className="shrink-0 text-right"><p className={`font-display text-xl ${game.id === selectedGame.id ? 'text-primary-ink' : 'text-foreground'}`}>{game.score} <span className="text-xs opacity-60">PTS</span></p></div></button>)}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}