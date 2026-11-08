import { collectCorrectedAthleteStats, computeHypeCardShareStats, type HypeCardSport } from "./hypeCardShareStats";

/** Private owner history. No public token, raw plays, or media is returned. */
export function nativeSeasonGames(payload: { tool?: string; games?: unknown[] }, sport: HypeCardSport) {
  const games = new Map<string, {
    id: string; sourceEventId: string | null; date: string; opponent: string;
    score: number; opponentScore: number; scoreRecorded: boolean;
    stats: Record<string, number>; athleteStats: Record<string, number>;
  }>();
  if (payload.tool !== "stat-tracker") return [];
  for (const raw of payload.games ?? []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const game = raw as Record<string, unknown>;
    if (typeof game.id !== "string" || !game.id || game.liveTapsOnly === true || game.type === "practice") continue;
    const summary = computeHypeCardShareStats({ tool: "stat-tracker", games: [game] }, "", sport, new Date(0))?.games[0];
    if (!summary) continue;
    const corrected = collectCorrectedAthleteStats(game.finalCorrection, sport, summary.stats);
    const athleteStats: Record<string, number> = corrected ?? Object.create(null);
    if (!corrected && Array.isArray(game.events)) {
      for (const rawPlay of game.events) {
        if (!rawPlay || typeof rawPlay !== "object") continue;
        const play = rawPlay as Record<string, unknown>;
        if (play.attribution !== "athlete" || play.possessionSide === "opponent"
          || typeof play.statId !== "string" || !Object.hasOwn(summary.stats, play.statId)) continue;
        const yards = play.statId === "pass-yard" || play.statId === "rush-yard";
        const count = yards && typeof play.yards === "number" && Number.isSafeInteger(play.yards)
          ? Math.max(0, play.yards) : yards ? 0 : 1;
        athleteStats[play.statId] = (athleteStats[play.statId] ?? 0) + count;
      }
    }
    games.set(game.id, {
      ...summary, id: game.id,
      sourceEventId: typeof game.sourceEventId === "string" ? game.sourceEventId : null,
      athleteStats,
    });
  }
  return [...games.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
