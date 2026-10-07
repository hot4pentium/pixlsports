import React, { useMemo, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GameSession, Sport } from './stat-tracker';
import {
  buildSupporterStatTrendModel,
  type SupporterStatTrendMetric,
  type SupporterStatTrendPoint,
} from './supporter-stat-trends-model';

type SupporterStatTrendsProps = {
  games: GameSession[];
  profileSport: Sport | null;
};

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: SupporterStatTrendPoint & { dateLabel: string } }>;
  metric: SupporterStatTrendMetric;
};

function formatGameDate(date: string) {
  const parsed = parseISO(date);
  return isValid(parsed) ? format(parsed, 'MMM d') : date;
}

function TrendTooltip({ active, payload, metric }: TooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="supporter-stat-trends__tooltip">
      <span>{formatGameDate(point.date)}</span>
      <strong>{point.opponent ? `vs ${point.opponent}` : 'Completed game'}</strong>
      <span>{metric.label}: {point.value}</span>
    </div>
  );
}

export default function SupporterStatTrends({ games, profileSport }: SupporterStatTrendsProps) {
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);
  const model = useMemo(
    () => buildSupporterStatTrendModel(games, profileSport, selectedMetricId),
    [games, profileSport, selectedMetricId],
  );
  const selectedMetric = model.selectedMetric;
  const chartData = useMemo(() => model.points.map((point) => ({
    ...point,
    dateLabel: formatGameDate(point.date),
  })), [model.points]);

  return (
    <section className="supporter-stat-trends" aria-labelledby="supporter-stat-trends-heading" data-testid="supporter-stat-trends">
      <header className="supporter-stat-trends__header">
        <div>
          <span className="supporter-stat-trends__eyebrow">COMBINED TEAM TREND</span>
          <h2 id="supporter-stat-trends-heading">STAT TRENDS</h2>
        </div>
        {selectedMetric && model.metrics.length > 1 ? (
          <label className="supporter-stat-trends__metric-label">
            <span className="sr-only">Choose a stat trend</span>
            <select
              value={selectedMetric.id}
              onChange={(event) => setSelectedMetricId(event.currentTarget.value)}
              data-testid="supporter-stat-trends-selector"
            >
              {model.metrics.map((metric) => (
                <option key={metric.id} value={metric.id}>{metric.label}</option>
              ))}
            </select>
          </label>
        ) : selectedMetric ? (
          <span className="supporter-stat-trends__metric-pill">{selectedMetric.label}</span>
        ) : null}
      </header>

      {selectedMetric ? (
        <>
          <div className="supporter-stat-trends__chart" data-testid="supporter-stat-trends-chart" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="rgba(184, 210, 242, .14)" strokeDasharray="3 4" />
                <XAxis
                  dataKey="dateLabel"
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  tick={{ fill: 'rgba(225, 236, 249, .68)', fontSize: 9, fontWeight: 700 }}
                />
                <YAxis
                  allowDecimals={false}
                  width={28}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'rgba(225, 236, 249, .55)', fontSize: 9 }}
                />
                <Tooltip content={<TrendTooltip metric={selectedMetric} />} />
                <Line
                  type="linear"
                  dataKey="value"
                  name={selectedMetric.label}
                  stroke="#1F74AD"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#71A5D2', stroke: '#0B1F3A', strokeWidth: 1.5 }}
                  activeDot={{ r: 5, fill: '#1F74AD', stroke: '#E7F2FF', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="supporter-stat-trends__period">
            Last {chartData.length} {selectedMetric.kind === 'score' ? 'scored' : 'completed'} {chartData.length === 1 ? 'game' : 'games'} · oldest to newest
          </p>
          <ol className="sr-only" aria-label={`${selectedMetric.label} trend values`}>
            {chartData.map((point) => (
              <li key={point.gameId}>
                {formatGameDate(point.date)}{point.opponent ? ` vs ${point.opponent}` : ''}: {selectedMetric.label} {point.value}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="supporter-stat-trends__empty" role="status" data-testid="supporter-stat-trends-empty">
          Complete a game with a recorded score or tracked stat to build this trend.
        </p>
      )}
    </section>
  );
}
