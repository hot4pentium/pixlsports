import React, { useEffect, useMemo } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
} from 'recharts';

import type { GameReport, SportRule } from './stat-tracker';

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
}: {
  report: GameReport;
  rule: SportRule;
  onClose: () => void;
  onSelectGame: (gameId: string) => void;
}) {
  const { selectedGame, seasonToDate, averages, previousGame } = report;
  const isOneGame = report.games.length === 1;
  const hasStats = Object.values(selectedGame.stats).some((value) => value > 0);

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

  const chartData = useMemo(() => report.games.map((game, index) => ({
    name: `G${index + 1}`,
    date: formatDate(game.date),
    score: game.score,
    opponent: game.opponent || 'TBD',
    isCurrent: game.id === selectedGame.id,
    gameId: game.id,
    ...Object.fromEntries(rule.stats.map((stat) => [stat.id, game.stats[stat.id] ?? 0])),
  })), [report.games, rule.stats, selectedGame.id]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
      <div className="border border-border bg-card p-3 shadow-lg clip-angled-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{data.date}</p>
        <p className="mt-1 font-display text-xl uppercase">vs {data.opponent}</p>
        <p className="font-display text-2xl text-primary">{data.score} PTS</p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md" data-testid="game-report-overlay" role="dialog" aria-modal="true" aria-labelledby="game-report-title">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-5 py-4 backdrop-blur-md sm:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Game Report</p>
          <h2 id="game-report-title" className="font-display text-2xl uppercase tracking-wide">{selectedGame.opponent ? `vs ${selectedGame.opponent}` : 'Game'}</h2>
        </div>
        <button type="button" autoFocus onClick={onClose} data-testid="game-report-close" className="inline-flex min-h-11 items-center justify-center gap-2 border border-border bg-card px-4 py-2 text-xs font-bold uppercase tracking-widest text-foreground hover:bg-muted clip-angled-sm"><ArrowLeft className="h-4 w-4" /> Back to Tracker</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-[1200px] space-y-6 sm:space-y-8">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="border border-primary/40 bg-primary/5 p-5 clip-angled-sm" data-testid="report-score-box"><p className="text-[10px] font-bold uppercase tracking-widest text-primary">Final Score</p><p className="mt-2 font-display text-5xl text-foreground sm:text-6xl">{selectedGame.score}<span className="text-muted-foreground">–</span><span className="text-muted-foreground">{selectedGame.opponentScore}</span></p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{formatDate(selectedGame.date)}</p></div>
            <div className="border border-border bg-card p-5 clip-angled-sm"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Season to Date (thru this game)</p><p className="mt-2 font-display text-4xl text-foreground sm:text-5xl">{seasonToDate.score} PTS</p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-primary">{seasonToDate.gamesPlayed} GAMES</p></div>
            <div className="border border-border bg-card p-5 clip-angled-sm"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Season Average</p><p className="mt-2 font-display text-4xl text-foreground sm:text-5xl">{averages.score.toFixed(1)} <span className="text-xl">PTS/G</span></p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">OVER {seasonToDate.gamesPlayed} GAMES</p></div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
                <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Box Score</h3>
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">{rule.stats.map((stat) => {
                  const count = selectedGame.stats[stat.id] || 0;
                  const previous = previousGame ? (previousGame.stats[stat.id] || 0) : 0;
                  const average = averages.stats[stat.id] || 0;
                  return <div key={stat.id} className="border border-border/50 bg-background p-3 clip-angled-sm" data-testid={`report-stat-${stat.id}`}><p className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{stat.label}</p><p className="mt-1 font-display text-3xl">{count}</p><p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-primary">Season: {seasonToDate.stats[stat.id] ?? 0}</p>{previousGame && <p className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${count > previous ? 'text-primary' : count < previous ? 'text-destructive' : 'text-muted-foreground'}`}>{count > previous ? '+' : ''}{count - previous} vs last</p>}{!isOneGame && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Avg: {average.toFixed(1)}</p>}</div>;
                })}</div>
                {!hasStats && <div className="mt-6 border border-border/50 bg-background p-6 text-center clip-angled-sm"><p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">No stats recorded for this game.</p></div>}
                {selectedGame.notes && <div className="mt-6 border-t border-border pt-4"><p className="text-[10px] font-bold uppercase tracking-widest text-primary"><FileText className="mr-1 inline h-3 w-3" /> Game Notes</p><p className="mt-2 text-sm font-medium text-foreground">{selectedGame.notes}</p></div>}
              </div>

              <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
                <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Scoring Trend</h3>
                {isOneGame ? <div className="mt-6 flex h-[200px] items-center justify-center border border-border/50 bg-background p-4 clip-angled-sm"><p className="text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">Play more games<br />to see trends.</p></div> : <div className="mt-6 h-[250px] w-full" data-testid="report-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} onClick={(data) => { if (data?.activePayload) onSelectGame(data.activePayload[0].payload.gameId); }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 'bold' }} axisLine={false} tickLine={false} /><RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} /><ReferenceLine y={averages.score} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ position: 'right', value: 'AVG', fill: 'hsl(var(--primary))', fontSize: 10, fontWeight: 'bold' }} /><Bar dataKey="score" radius={[2, 2, 0, 0]} className="cursor-pointer" aria-label="Score">{chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.3)'} />)}</Bar></BarChart></ResponsiveContainer></div>}
              </div>

              <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
                <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Stat Trends</h3><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Game-to-game leaders for {rule.label}</p>
                {!trendStats.length ? <div className="mt-6 flex h-[200px] items-center justify-center border border-border/50 bg-background p-4 clip-angled-sm"><p className="text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">No tracked stats yet.</p></div> : isOneGame ? <div className="mt-6 flex h-[200px] items-center justify-center border border-border/50 bg-background p-4 clip-angled-sm"><p className="text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">Play more games<br />to compare stat trends.</p></div> : <div className="mt-6 h-[280px] w-full" data-testid="report-stat-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 'bold' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} /><RechartsTooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} contentStyle={{ border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }} labelFormatter={(label) => `${label} · ${chartData.find((game) => game.name === label)?.opponent ?? ''}`} /><Legend wrapperStyle={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }} />{trendStats.map((stat, statIndex) => <Bar key={stat.id} dataKey={stat.id} name={stat.shortLabel} radius={[2, 2, 0, 0]}>{chartData.map((entry, gameIndex) => <Cell key={`${stat.id}-${gameIndex}`} fill={entry.isCurrent ? 'hsl(var(--primary))' : `hsl(var(--foreground) / ${0.18 + statIndex * 0.12})`} />)}</Bar>)}</BarChart></ResponsiveContainer></div>}
              </div>
            </div>

            <div className="border border-border bg-card p-5 clip-angled-sm"><h3 className="font-display text-xl uppercase tracking-wide text-foreground">Season Log</h3><div className="mt-5 space-y-2">{report.games.map((game, index) => <button type="button" key={game.id} onClick={() => onSelectGame(game.id)} data-testid={`history-nav-${game.id}`} className={`flex w-full items-center justify-between border p-3 text-left transition-colors clip-angled-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${game.id === selectedGame.id ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}><div className="min-w-0"><p className={`truncate font-display uppercase ${game.id === selectedGame.id ? 'text-primary' : 'text-foreground'}`}>G{index + 1} <span className="ml-1 text-sm opacity-60">vs {game.opponent || 'TBD'}</span></p><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{formatDate(game.date)}</p></div><div className="shrink-0 text-right"><p className={`font-display text-xl ${game.id === selectedGame.id ? 'text-primary' : 'text-foreground'}`}>{game.score} <span className="text-xs opacity-60">PTS</span></p></div></button>)}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}