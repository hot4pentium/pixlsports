import type { Sport } from './stat-tracker';

export type SupporterGameRecord = {
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
};

type SupporterRecordGame = {
  id: string;
  status: string;
  sport: Sport;
  score: number;
  opponentScore: number;
};

export function buildSupporterGameRecord(
  games: readonly SupporterRecordGame[],
  scoredGameIds: ReadonlySet<string>,
  sport: Sport | null,
): SupporterGameRecord {
  const record: SupporterGameRecord = { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 };

  for (const game of games) {
    if (
      game.status !== 'final'
      || !scoredGameIds.has(game.id)
      || (sport !== null && game.sport !== sport)
      || !Number.isFinite(game.score)
      || !Number.isFinite(game.opponentScore)
    ) {
      continue;
    }

    record.gamesPlayed += 1;
    if (game.score > game.opponentScore) record.wins += 1;
    else if (game.score < game.opponentScore) record.losses += 1;
    else record.ties += 1;
  }

  return record;
}