export type Sport = 'baseball' | 'basketball' | 'football' | 'soccer' | 'volleyball';
export type GameStatus = 'setup' | 'live' | 'paused' | 'final';

export type StatDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  points: number;
  featured?: boolean;
};

export type SportRule = {
  id: Sport;
  label: string;
  phaseLabel: string;
  stats: StatDefinition[];
};

export type StatEvent = {
  id: string;
  statId: string;
  createdAt: string;
  period: number;
};

export type GameSession = {
  id: string;
  sport: Sport;
  status: GameStatus;
  date: string;
  opponent: string;
  period: number;
  score: number;
  opponentScore: number;
  notes: string;
  stats: Record<string, number>;
  events: StatEvent[];
  startedAt: string;
  endedAt?: string;
};

export type StatTrackerData = {
  version: 1;
  games: GameSession[];
};

const stat = (
  id: string,
  label: string,
  shortLabel: string,
  points: number,
  featured = true,
): StatDefinition => ({ id, label, shortLabel, points, featured });

export const sportRules: Record<Sport, SportRule> = {
  basketball: {
    id: 'basketball',
    label: 'Basketball',
    phaseLabel: 'Quarter',
    stats: [
      stat('one-point', 'Free throw', '1 PT', 1),
      stat('two-point', 'Two-point field goal', '2 PT', 2),
      stat('three-point', 'Three-point field goal', '3 PT', 3),
      stat('rebound', 'Rebound', 'REB', 0),
      stat('assist', 'Assist', 'AST', 0),
      stat('steal', 'Steal', 'STL', 0),
      stat('block', 'Block', 'BLK', 0),
      stat('turnover', 'Turnover', 'TO', 0, false),
      stat('foul', 'Foul', 'FOUL', 0, false),
    ],
  },
  soccer: {
    id: 'soccer',
    label: 'Soccer',
    phaseLabel: 'Half',
    stats: [
      stat('goal', 'Goal', 'GOAL', 1),
      stat('assist', 'Assist', 'AST', 0),
      stat('shot', 'Shot', 'SHOT', 0),
      stat('shot-on-target', 'Shot on target', 'SOG', 0),
      stat('save', 'Save', 'SAVE', 0),
      stat('yellow-card', 'Yellow card', 'YC', 0),
      stat('red-card', 'Red card', 'RC', 0, false),
    ],
  },
  football: {
    id: 'football',
    label: 'Football',
    phaseLabel: 'Quarter',
    stats: [
      stat('touchdown', 'Touchdown', 'TD', 6),
      stat('field-goal', 'Field goal', 'FG', 3),
      stat('extra-point', 'Extra point', 'XP', 1),
      stat('two-point-conversion', 'Two-point conversion', '2 PT', 2),
      stat('pass-yard', 'Passing yards', 'PASS YDS', 0),
      stat('rush-yard', 'Rushing yards', 'RUSH YDS', 0),
      stat('reception', 'Reception', 'REC', 0),
      stat('tackle', 'Tackle', 'TACKLE', 0),
      stat('interception', 'Interception', 'INT', 0, false),
      stat('sack', 'Sack', 'SACK', 0, false),
    ],
  },
  baseball: {
    id: 'baseball',
    label: 'Baseball',
    phaseLabel: 'Inning',
    stats: [
      stat('run', 'Run', 'RUN', 1),
      stat('hit', 'Hit', 'HIT', 0),
      stat('rbi', 'Run batted in', 'RBI', 1),
      stat('home-run', 'Home run', 'HR', 4),
      stat('strikeout', 'Strikeout', 'K', 0),
      stat('walk', 'Walk', 'BB', 0),
      stat('stolen-base', 'Stolen base', 'SB', 0, false),
      stat('pitch', 'Pitch thrown', 'PITCH', 0, false),
    ],
  },
  volleyball: {
    id: 'volleyball',
    label: 'Volleyball',
    phaseLabel: 'Set',
    stats: [
      stat('kill', 'Kill', 'KILL', 1),
      stat('ace', 'Ace', 'ACE', 1),
      stat('block', 'Block', 'BLK', 1),
      stat('dig', 'Dig', 'DIG', 0),
      stat('assist', 'Assist', 'AST', 0),
      stat('service-error', 'Service error', 'ERR', 0),
      stat('reception', 'Reception', 'REC', 0, false),
    ],
  },
};

export const sports = (Object.keys(sportRules) as Sport[]);

export function getSportRule(sport: Sport): SportRule {
  return sportRules[sport];
}

export function isSport(value: unknown): value is Sport {
  return typeof value === 'string' && sports.includes(value as Sport);
}

export function createGameSession(
  sport: Sport,
  input: { date?: string; opponent?: string; notes?: string },
  now = new Date(),
): GameSession {
  return {
    id: `tracker-game-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    sport,
    status: 'live',
    date: input.date ?? now.toISOString().slice(0, 10),
    opponent: input.opponent?.trim() ?? '',
    period: 1,
    score: 0,
    opponentScore: 0,
    notes: input.notes?.trim() ?? '',
    stats: {},
    events: [],
    startedAt: now.toISOString(),
  };
}

export function adjustScore(
  game: GameSession,
  side: 'athlete' | 'opponent',
  delta: number,
): GameSession {
  if (game.status === 'final' || !Number.isFinite(delta) || delta === 0) return game;
  const nextScore = Math.max(0, (side === 'athlete' ? game.score : game.opponentScore) + delta);
  return side === 'athlete'
    ? { ...game, score: nextScore }
    : { ...game, opponentScore: nextScore };
}

export function addStatEvent(game: GameSession, statId: string, now = new Date()): GameSession {
  const definition = getSportRule(game.sport).stats.find((item) => item.id === statId);
  if (!definition || game.status !== 'live') return game;
  const event: StatEvent = {
    id: `tracker-event-${now.getTime()}-${game.events.length}`,
    statId,
    createdAt: now.toISOString(),
    period: game.period,
  };
  return {
    ...game,
    stats: { ...game.stats, [statId]: (game.stats[statId] ?? 0) + 1 },
    score: game.score + definition.points,
    events: [...game.events, event],
  };
}

export function undoLastStatEvent(game: GameSession): GameSession {
  const event = game.events.at(-1);
  if (!event || game.status === 'final') return game;
  const definition = getSportRule(game.sport).stats.find((item) => item.id === event.statId);
  const nextCount = Math.max(0, (game.stats[event.statId] ?? 0) - 1);
  const stats = { ...game.stats };
  if (nextCount === 0) delete stats[event.statId];
  else stats[event.statId] = nextCount;
  return {
    ...game,
    stats,
    score: Math.max(0, game.score - (definition?.points ?? 0)),
    events: game.events.slice(0, -1),
  };
}

export function endGame(game: GameSession, now = new Date()): GameSession {
  if (game.status === 'final') return game;
  return { ...game, status: 'final', endedAt: now.toISOString() };
}

export function normalizeTrackerData(value: unknown): StatTrackerData {
  const input = typeof value === 'object' && value !== null ? value as Partial<StatTrackerData> : {};
  const games = Array.isArray(input.games)
    ? input.games.filter((game): game is GameSession => (
      typeof game === 'object'
      && game !== null
      && isSport((game as GameSession).sport)
      && typeof (game as GameSession).id === 'string'
      && typeof (game as GameSession).date === 'string'
      && typeof (game as GameSession).score === 'number'
      && typeof (game as GameSession).stats === 'object'
      && Array.isArray((game as GameSession).events)
    ))
    .map((game) => ({
      ...game,
      opponentScore: typeof game.opponentScore === 'number' ? Math.max(0, game.opponentScore) : 0,
      notes: typeof game.notes === 'string' ? game.notes : '',
    }))
    : [];
  return { version: 1, games };
}

export function seasonTotals(games: GameSession[], sport: Sport) {
  const totals: Record<string, number> = {};
  let score = 0;
  let gamesPlayed = 0;
  for (const game of games) {
    if (game.sport !== sport || game.status !== 'final') continue;
    gamesPlayed += 1;
    score += game.score;
    for (const [statId, count] of Object.entries(game.stats)) {
      totals[statId] = (totals[statId] ?? 0) + count;
    }
  }
  return { gamesPlayed, score, stats: totals };
}