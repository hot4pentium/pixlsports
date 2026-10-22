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

function safeStatId(value: unknown) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ? value : null;
}

function collectSafeStats(value: unknown) {
  const totals = Object.create(null) as Record<string, number>;
  if (!value || typeof value !== "object" || Array.isArray(value)) return totals;

  for (const [key, count] of Object.entries(value)) {
    if (!safeStatId(key)) continue;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    totals[key] = Math.trunc(count);
  }
  return totals;
}

function collectAthleteStats(value: unknown) {
  const totals = Object.create(null) as Record<string, number>;
  if (!Array.isArray(value)) return totals;

  for (const event of value) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const item = event as { attribution?: unknown; statId?: unknown };
    const statId = safeStatId(item.statId);
    if (item.attribution !== "athlete" || !statId) continue;
    totals[statId] = (totals[statId] ?? 0) + 1;
  }
  return totals;
}

const CORRECTABLE_STAT_IDS: Record<HypeCardSport, ReadonlySet<string>> = {
  basketball: new Set(["one-point", "two-point", "three-point", "rebound", "assist", "steal", "block", "turnover", "foul"]),
  football: new Set(["touchdown", "field-goal", "extra-point", "two-point-conversion", "pass-yard", "rush-yard", "reception", "tackle", "interception", "sack"]),
  soccer: new Set(["goal", "assist", "shot", "shot-on-target", "corner-kick", "penalty-kick", "save", "yellow-card", "red-card"]),
  baseball: new Set(["run", "hit", "single", "double", "triple", "rbi", "home-run", "strikeout", "walk", "stolen-base", "pitch", "fastball", "changeup", "slider", "curveball", "four-seam-fastball", "two-seam-fastball"]),
  softball: new Set(["run", "hit", "rbi", "home-run", "strikeout", "walk", "stolen-base", "pitch"]),
  volleyball: new Set(["kill", "ace", "block", "dig", "assist", "service-error", "reception"]),
};

function collectCorrectedAthleteStats(value: unknown, sport: HypeCardSport, stats: Record<string, number>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const correction = value as { athleteStats?: unknown; correctedAt?: unknown };
  if (typeof correction.correctedAt !== "string" || !Number.isFinite(Date.parse(correction.correctedAt))) return null;
  if (!correction.athleteStats || typeof correction.athleteStats !== "object" || Array.isArray(correction.athleteStats)) return null;
  const result = Object.create(null) as Record<string, number>;
  for (const [statId, count] of Object.entries(correction.athleteStats)) {
    if (!CORRECTABLE_STAT_IDS[sport].has(statId)
      || typeof count !== "number"
      || !Number.isSafeInteger(count)
      || count < 0
      || count > (stats[statId] ?? 0)) return null;
    result[statId] = count;
  }
  return result;
}

function safeScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function hasRecordedScoreline(item: Record<string, unknown>) {
  if (typeof item.scoreRecorded === "boolean") return item.scoreRecorded;
  const score = item.score;
  const opponentScore = item.opponentScore;
  return typeof score === "number"
    && Number.isInteger(score)
    && score >= 0
    && typeof opponentScore === "number"
    && Number.isInteger(opponentScore)
    && opponentScore >= 0
    && (score > 0 || opponentScore > 0);
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
    scoreRecorded: boolean;
    stats: Record<string, number>;
    athleteStats: Record<string, number>;
  }> = [];
  const record = { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 };
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
      scoreRecorded?: unknown;
      outcome?: unknown;
      stats?: unknown;
      events?: unknown;
      finalCorrection?: unknown;
    };
    if (item.sport !== sport || item.status !== "final") continue;
    const gameStats = collectSafeStats(item.stats);
    const correctedAthleteStats = collectCorrectedAthleteStats(item.finalCorrection, sport, gameStats);
    const athleteStats = correctedAthleteStats ?? collectAthleteStats(item.events);
    gamesPlayed += 1;
    const gameScore = safeScore(item.score);
    const scoreRecorded = hasRecordedScoreline(item);
    const opponentScore = safeScore(item.opponentScore);
    if (scoreRecorded) score += gameScore;
    const outcome = item.outcome === "win" || item.outcome === "loss" || item.outcome === "tie"
      ? item.outcome
      : scoreRecorded ? gameScore > opponentScore ? "win" : gameScore < opponentScore ? "loss" : "tie" : null;
    if (outcome) {
      record.gamesPlayed += 1;
      if (outcome === "win") record.wins += 1;
      else if (outcome === "loss") record.losses += 1;
      else record.ties += 1;
    }
    games.push({
      date: typeof item.date === "string" ? item.date.slice(0, 30) : "",
      opponent: typeof item.opponent === "string" ? item.opponent.slice(0, 240) : "",
      score: gameScore,
      opponentScore,
      scoreRecorded,
      stats: gameStats,
      athleteStats,
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
    record,
    games,
    stats: totals,
    updatedAt,
  };
}