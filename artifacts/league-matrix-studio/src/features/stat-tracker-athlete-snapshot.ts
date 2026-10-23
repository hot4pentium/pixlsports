import { getFootballYardMetricId } from './stat-tracker';

type SnapshotEvent = {
  statId: string;
  attribution?: string;
  possessionSide?: string;
  yards?: number | null;
};

/** Aggregate before the public feed is truncated; team/opponent plays never count. */
export function getAthleteSnapshotStats(sport: string, events: readonly SnapshotEvent[]) {
  const stats: Record<string, number> = Object.create(null);
  const yardStats: Record<string, number> = Object.create(null);
  for (const event of events) {
    if (event.attribution !== 'athlete' || event.possessionSide === 'opponent') continue;
    stats[event.statId] = (stats[event.statId] ?? 0) + 1;
    const yardMetricId = sport === 'football' ? getFootballYardMetricId(event.statId) : null;
    if (yardMetricId && typeof event.yards === 'number' && Number.isFinite(event.yards) && event.yards > 0) {
      yardStats[yardMetricId] = (yardStats[yardMetricId] ?? 0) + event.yards;
    }
  }
  return { stats: { ...stats }, yardStats: { ...yardStats } };
}
