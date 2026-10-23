import type { StatTrackerShare, StatTrackerShareInput } from '@workspace/api-client-react';
import type { GameSession } from './stat-tracker';
import { getAthleteSnapshotStats } from './stat-tracker-athlete-snapshot';

export async function copyStatTrackerShareUrl(
  url: string,
  input: HTMLInputElement | null,
  clipboard: Pick<Clipboard, 'writeText'> | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.clipboard,
  legacyCopy: () => boolean = () =>
    typeof document !== 'undefined' && document.execCommand('copy'),
): Promise<boolean> {
  if (!url) return false;
  input?.focus();
  input?.select();
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(url);
      return true;
    }
  } catch {
    // Continue to the selection-based fallback for browsers that reject clipboard writes.
  }
  try {
    input?.focus();
    input?.select();
    return legacyCopy();
  } catch {
    return false;
  }
}

export function toStatTrackerShareInput(
  game: GameSession,
  athleteName: string,
  teamName: string,
): StatTrackerShareInput {
  const athleteSnapshot = getAthleteSnapshotStats(game.sport, game.events);
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
      ...(game.sport === 'football' ? {
        possessionSide: game.possessionSide ?? 'athlete',
        opponentStats: { ...(game.opponentStats ?? {}) },
        opponentYardStats: { ...(game.opponentYardStats ?? {}) },
      } : {}),
      stats: { ...game.stats },
      athleteStats: athleteSnapshot.stats,
      athleteYardStats: athleteSnapshot.yardStats,
      trackYards: game.trackYards === true,
      yardStats: { ...(game.yardStats ?? {}) },
      events: game.events.slice(-10).map((event) => ({
        id: event.id,
        statId: event.statId,
        createdAt: event.createdAt,
        period: event.period,
        attribution: event.attribution === 'athlete' ? 'athlete' : 'team',
        ...(game.sport === 'football' ? { possessionSide: event.possessionSide ?? 'athlete' } : {}),
        ...(event.playId ? { playId: event.playId } : {}),
        yards: typeof event.yards === 'number' && Number.isFinite(event.yards) ? event.yards : null,
      })),
    },
  };
}

// Compare the published game, not just its status: resolving a cloud-history
// conflict can replace an already-final local game with a corrected final.
export function needsFinalTrackerShareUpdate(
  share: Pick<StatTrackerShare, 'athleteName' | 'teamName' | 'game'>,
  game: GameSession,
  athleteName: string,
  teamName: string,
): boolean {
  const canonical = (value: unknown) => JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
  return canonical({ athleteName: share.athleteName, teamName: share.teamName, game: share.game })
    !== canonical(toStatTrackerShareInput(game, athleteName, teamName));
}