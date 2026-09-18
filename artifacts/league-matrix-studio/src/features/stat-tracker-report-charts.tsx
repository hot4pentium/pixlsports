import React, { useMemo } from 'react';
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

import type { GameReport, SportRule, StatDefinition } from './stat-tracker';

function formatDate(value: string) {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ReportCharts({
  report,
  rule,
  trendStats,
  onSelectGame,
}: {
  report: GameReport;
  rule: SportRule;
  trendStats: StatDefinition[];
  onSelectGame: (gameId: string) => void;
}) {
  const chartData = useMemo(() => report.games.map((game, index) => ({
    name: `G${index + 1}`,
    date: formatDate(game.date),
    score: game.score,
    opponent: game.opponent || 'TBD',
    isCurrent: game.id === report.selectedGame.id,
    gameId: game.id,
    ...Object.fromEntries(rule.stats.map((stat) => [stat.id, game.stats[stat.id] ?? 0])),
  })), [report.games, report.selectedGame.id, rule.stats]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return <div className="border border-border bg-card p-3 shadow-lg clip-angled-sm"><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{data.date}</p><p className="mt-1 font-display text-xl uppercase">vs {data.opponent}</p><p className="font-display text-2xl text-primary">{data.score} PTS</p></div>;
  };

  return (
    <>
      <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
        <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Scoring Trend</h3>
        <div className="mt-6 h-[250px] w-full" data-testid="report-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} onClick={(data) => { if (data?.activePayload) onSelectGame(data.activePayload[0].payload.gameId); }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 'bold' }} axisLine={false} tickLine={false} /><RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} /><ReferenceLine y={report.averages.score} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ position: 'right', value: 'AVG', fill: 'hsl(var(--primary))', fontSize: 10, fontWeight: 'bold' }} /><Bar dataKey="score" radius={[2, 2, 0, 0]} className="cursor-pointer" aria-label="Score">{chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.3)'} />)}</Bar></BarChart></ResponsiveContainer></div>
      </div>

      <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
        <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Stat Trends</h3><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Game-to-game leaders for {rule.label}</p>
        {!trendStats.length ? <div className="mt-6 flex h-[200px] items-center justify-center border border-border/50 bg-background p-4 clip-angled-sm"><p className="text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">No tracked stats yet.</p></div> : <div className="mt-6 h-[280px] w-full" data-testid="report-stat-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 'bold' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} /><RechartsTooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} contentStyle={{ border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }} labelFormatter={(label) => `${label} · ${chartData.find((game) => game.name === label)?.opponent ?? ''}`} /><Legend wrapperStyle={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }} />{trendStats.map((stat, statIndex) => <Bar key={stat.id} dataKey={stat.id} name={stat.shortLabel} radius={[2, 2, 0, 0]}>{chartData.map((entry, gameIndex) => <Cell key={`${stat.id}-${gameIndex}`} fill={entry.isCurrent ? 'hsl(var(--primary))' : `hsl(var(--foreground) / ${0.18 + statIndex * 0.12})`} />)}</Bar>)}</BarChart></ResponsiveContainer></div>}
      </div>
    </>
  );
}