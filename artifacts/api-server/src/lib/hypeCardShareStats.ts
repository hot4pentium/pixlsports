export const HYPE_CARD_SPORTS = [
  "baseball",
  "basketball",
  "football",
  "soccer",
  "softball",
  "volleyball",
] as const;

export type HypeCardSport = (typeof HYPE_CARD_SPORTS)[number];

export function isHypeCardSport(value: unknown): value is HypeCardSport {
  return typeof value === "string" && HYPE_CARD_SPORTS.includes(value as HypeCardSport);
}

function collectSafeStats(value: unknown) {
  const totals = Object.create(null) as Record<string, number>;
  if (!value || typeof value !== "object" || Array.isArray(value)) return totals;

  for (const [key, count] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) continue;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    totals[key] = Math.trunc(count);
  }
  return totals;
}

function safeScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function computeHypeCardShareStats(
  payload: unknown,
  athleteName: string,
  sport: HypeCardSport,
  updatedAt: Date,
) {
  if (!payload || typeof payload !== "object") return null;
  const tracker = payload as { tool?: unknown; games?: unknown };
  if (tracker.tool !== "stat-tracker" || !Array.isArray(tracker.games)) return null;

  const totals = Object.create(null) as Record<string, number>;
  const games: Array<{
    date: string;
    opponent: string;
    score: number;
    opponentScore: number;
    stats: Record<string, number>;
  }> = [];
  let gamesPlayed = 0;
  let score = 0;
  for (const game of tracker.games) {
    if (!game || typeof game !== "object") continue;
    const item = game as {
      sport?: unknown;
      status?: unknown;
      date?: unknown;
      opponent?: unknown;
      score?: unknown;
      opponentScore?: unknown;
      stats?: unknown;
    };
    if (item.sport !== sport || item.status !== "final") continue;
    const gameStats = collectSafeStats(item.stats);
    gamesPlayed += 1;
    const gameScore = safeScore(item.score);
    score += gameScore;
    games.push({
      date: typeof item.date === "string" ? item.date.slice(0, 30) : "",
      opponent: typeof item.opponent === "string" ? item.opponent.slice(0, 240) : "",
      score: gameScore,
      opponentScore: safeScore(item.opponentScore),
      stats: gameStats,
    });
    for (const [key, value] of Object.entries(gameStats)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }

  return {
    athleteName,
    sport,
    gamesPlayed,
    score,
    games,
    stats: totals,
    updatedAt,
  };
}