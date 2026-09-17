export const HYPE_CARD_SPORTS = [
  "baseball",
  "basketball",
  "football",
  "soccer",
  "volleyball",
] as const;

export type HypeCardSport = (typeof HYPE_CARD_SPORTS)[number];

export function isHypeCardSport(value: unknown): value is HypeCardSport {
  return typeof value === "string" && HYPE_CARD_SPORTS.includes(value as HypeCardSport);
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
  let gamesPlayed = 0;
  let score = 0;
  for (const game of tracker.games) {
    if (!game || typeof game !== "object") continue;
    const item = game as { sport?: unknown; status?: unknown; score?: unknown; stats?: unknown };
    if (item.sport !== sport || item.status !== "final") continue;
    gamesPlayed += 1;
    if (typeof item.score === "number" && Number.isFinite(item.score)) {
      score += Math.max(0, Math.trunc(item.score));
    }
    if (!item.stats || typeof item.stats !== "object" || Array.isArray(item.stats)) continue;
    for (const [key, value] of Object.entries(item.stats)) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      totals[key] = (totals[key] ?? 0) + Math.trunc(value);
    }
  }

  return {
    athleteName,
    sport,
    gamesPlayed,
    score,
    stats: totals,
    updatedAt,
  };
}