import type { StatTrackerShareInput } from '@workspace/api-client-react';
import type { GameSession } from './stat-tracker';

export function toStatTrackerShareInput(
  game: GameSession,
  athleteName: string,
  teamName: string,
): StatTrackerShareInput {
  return {
    athleteName,
    teamName,
    game: {
      id: game.id,
      sport: game.sport,
      status: game.status,
      date: game.date,
      opponent: game.opponent,
      period: game.period,
      ...(game.sport === 'soccer' && (game.soccerPeriodFormat === 'halves' || game.soccerPeriodFormat === 'quarters')
        ? { soccerPeriodFormat: game.soccerPeriodFormat }
        : {}),
      score: game.score,
      opponentScore: game.opponentScore,
      stats: { ...game.stats },
      trackYards: game.trackYards === true,
      yardStats: { ...(game.yardStats ?? {}) },
      events: game.events.slice(-10).map((event) => ({
        id: event.id,
        statId: event.statId,
        createdAt: event.createdAt,
        period: event.period,
        attribution: event.attribution === 'athlete' ? 'athlete' : 'team',
        ...(event.playId ? { playId: event.playId } : {}),
        yards: typeof event.yards === 'number' && Number.isFinite(event.yards) ? event.yards : null,
      })),
    },
  };
}