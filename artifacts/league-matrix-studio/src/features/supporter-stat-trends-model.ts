import {
  getSportRule,
  getTrackerSportForProfile,
  hasRecordedGameScore,
  type GameSession,
  type Sport,
} from './stat-tracker';

export const SUPPORTER_STAT_TREND_GAME_LIMIT = 6;

export type SupporterStatTrendMetric = {
  id: string;
  label: string;
  kind: 'score' | 'stat';
  statId?: string;
};

export type SupporterStatTrendPoint = {
  gameId: string;
  date: string;
  opponent: string;
  value: number;
};

export type SupporterStatTrendModel = {
  sport: Sport | null;
  metrics: SupporterStatTrendMetric[];
  selectedMetric: SupporterStatTrendMetric | null;
  points: SupporterStatTrendPoint[];
  availableGameCount: number;
};

export function buildSupporterStatTrendModel(
  games: readonly GameSession[],
  profileSport: Sport | null,
  selectedMetricId?: string | null,
): SupporterStatTrendModel {
  const sport = getTrackerSportForProfile({ version: 1, games: [...games] }, profileSport);
  if (!sport) {
    return { sport: null, metrics: [], selectedMetric: null, points: [], availableGameCount: 0 };
  }

  const orderedGames = games
    .map((game, index) => ({ game, index }))
    .filter(({ game }) => game.status === 'final' && game.sport === sport)
    .sort((left, right) => (
      left.game.date.localeCompare(right.game.date)
      || (left.game.endedAt ?? left.game.startedAt).localeCompare(right.game.endedAt ?? right.game.startedAt)
      || left.index - right.index
    ))
    .map(({ game }) => game);

  const metrics: SupporterStatTrendMetric[] = [];
  if (orderedGames.some(hasRecordedGameScore)) {
    metrics.push({ id: 'team-score', label: 'Team score', kind: 'score' });
  }

  for (const stat of getSportRule(sport).stats) {
    if (orderedGames.some((game) => {
      const value = game.stats[stat.id];
      return Number.isFinite(value) && value > 0;
    })) {
      metrics.push({ id: stat.id, label: stat.label, kind: 'stat', statId: stat.id });
    }
  }

  const selectedMetric = metrics.find((metric) => metric.id === selectedMetricId) ?? metrics[0] ?? null;
  if (!selectedMetric) {
    return {
      sport,
      metrics,
      selectedMetric: null,
      points: [],
      availableGameCount: orderedGames.length,
    };
  }

  const metricGames = selectedMetric.kind === 'score'
    ? orderedGames.filter(hasRecordedGameScore)
    : orderedGames;
  const points = metricGames.slice(-SUPPORTER_STAT_TREND_GAME_LIMIT).map((game) => ({
    gameId: game.id,
    date: game.date,
    opponent: game.opponent,
    value: selectedMetric.kind === 'score'
      ? game.score
      : game.stats[selectedMetric.statId!] ?? 0,
  }));

  return {
    sport,
    metrics,
    selectedMetric,
    points,
    availableGameCount: metricGames.length,
  };
}
