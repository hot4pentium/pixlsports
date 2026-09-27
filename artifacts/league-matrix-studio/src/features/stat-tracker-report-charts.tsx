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

import { hasRecordedGameScore, type GameReport, type SportRule, type StatDefinition } from './stat-tracker';

const TREND_COLORS = ['#2474f5', '#b94a16', '#16806f', '#8053ad'];

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
  const scoredChartData = useMemo(() => chartData.filter((entry) => (
    hasRecordedGameScore(report.games.find((game) => game.id === entry.gameId)!)
  )), [chartData, report.games]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return <div className="border p-3 shadow-lg clip-angled-sm" style={{ borderColor: 'var(--report-tooltip-border, hsl(var(--border)))', background: 'var(--report-tooltip-bg, hsl(var(--card)))', color: 'var(--report-tooltip-ink, hsl(var(--card-foreground)))' }}><p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--report-chart-muted, hsl(var(--muted-foreground)))' }}>{data.date}</p><p className="mt-1 font-display text-xl uppercase">vs {data.opponent}</p><p className="font-display text-2xl" style={{ color: 'var(--report-score-ink, hsl(var(--primary-ink)))' }}>Team score: {data.score}</p></div>;
  };

  return (
    <>
      <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
        <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Scoring Trend</h3>
        {scoredChartData.length
          ? <div className="mt-6 h-[250px] w-full" data-testid="report-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={scoredChartData} onClick={(data) => { if (data?.activePayload) onSelectGame(data.activePayload[0].payload.gameId); }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 'bold' }} axisLine={false} tickLine={false} /><RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} /><ReferenceLine y={report.averages.score} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ position: 'right', value: 'AVG', fill: 'hsl(var(--primary))', fontSize: 10, fontWeight: 'bold' }} /><Bar dataKey="score" radius={[2, 2, 0, 0]} className="cursor-pointer" aria-label="Team score">{scoredChartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.3)'} />)}</Bar></BarChart></ResponsiveContainer></div>
          : <p className="mt-6 text-sm text-muted-foreground">No final scores were recorded for these games.</p>}
      </div>

      <div className="border border-border bg-card p-5 clip-angled-sm sm:p-7">
        <h3 className="font-display text-2xl uppercase tracking-wide text-foreground">Stat Trends</h3><p className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Game-to-game leaders for {rule.label}</p>
        {!trendStats.length ? <div className="mt-6 flex h-[200px] items-center justify-center border border-border/50 bg-background p-4 clip-angled-sm"><p className="text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">No tracked stats yet.</p></div> : (
          <div className="mt-6 h-[280px] w-full" data-testid="report-stat-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--report-chart-grid, hsl(var(--border)))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--report-chart-muted, hsl(var(--muted-foreground)))', fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: 'var(--report-chart-muted, hsl(var(--muted-foreground)))' }} axisLine={false} tickLine={false} />
                <RechartsTooltip
                  cursor={{ fill: 'var(--report-chart-cursor, hsl(var(--muted)))', opacity: 0.4 }}
                  contentStyle={{ border: '1px solid var(--report-tooltip-border, hsl(var(--border)))', borderRadius: 6, background: 'var(--report-tooltip-bg, hsl(var(--card)))', color: 'var(--report-tooltip-ink, hsl(var(--card-foreground)))', boxShadow: '0 12px 28px rgba(12, 31, 58, .18)' }}
                  labelStyle={{ color: 'var(--report-tooltip-ink, hsl(var(--card-foreground)))', fontWeight: 700 }}
                  itemStyle={{ color: 'var(--report-tooltip-ink, hsl(var(--card-foreground)))' }}
                  labelFormatter={(label) => `${label} · ${chartData.find((game) => game.name === label)?.opponent ?? ''}`}
                />
                <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--report-chart-muted, hsl(var(--muted-foreground)))' }} />
                {trendStats.map((stat, statIndex) => (
                  <Bar key={stat.id} dataKey={stat.id} name={stat.shortLabel} fill={TREND_COLORS[statIndex % TREND_COLORS.length]} radius={[2, 2, 0, 0]}>
                    {chartData.map((entry, gameIndex) => <Cell key={`${stat.id}-${gameIndex}`} fill={TREND_COLORS[statIndex % TREND_COLORS.length]} fillOpacity={entry.isCurrent ? 1 : 0.72} />)}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}