export type Sport = 'baseball' | 'basketball' | 'football' | 'soccer' | 'softball' | 'volleyball';
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

export type GameReport = {
  games: GameSession[];
  selectedGame: GameSession;
  selectedIndex: number;
  previousGame: GameSession | null;
  seasonToDate: ReturnType<typeof seasonTotals>;
  averages: {
    score: number;
    stats: Record<string, number>;
  };
};

export type TrackerCloudProject = {
  id: string;
  revision: number;
};

export type TrackerConflict = {
  localData: StatTrackerData;
  cloudData: StatTrackerData;
  cloudProject: TrackerCloudProject;
};

export type TrackerConflictResolution = 'local' | 'cloud' | 'merge';

export type StoredTrackerConflict = {
  resolution: TrackerConflictResolution | null;
  data: StatTrackerData;
  cloudData: StatTrackerData;
  cloudProject: TrackerCloudProject;
};

export type TrackerPayload = StatTrackerData & {
  tool: 'stat-tracker';
};

export type TrackerSyncClient = {
  createProject: (input: {
    data: {
      name: string;
      project: TrackerPayload;
      guestUsageKey?: string;
    };
  }) => Promise<TrackerCloudProject>;
  updateProject: (input: {
    projectId: string;
    data: {
      project: TrackerPayload;
      expectedRevision: number;
    };
  }) => Promise<TrackerCloudProject>;
};

export type TrackerStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export const trackerLocalStorageKey = 'leaguematrix-stat-tracker';
export const activeGameStorageKey = 'leaguematrix-stat-tracker-active-game';

export function getTrackerStorageKeys(accountId: string) {
  const suffix = encodeURIComponent(accountId);
  return {
    history: `${trackerLocalStorageKey}:${suffix}`,
    activeGame: `${activeGameStorageKey}:${suffix}`,
    pendingConflict: `${trackerLocalStorageKey}:pending-conflict:${suffix}`,
  };
}

function migrateLegacyStorageValue(storage: TrackerStorage, legacyKey: string, scopedKey: string) {
  const legacyValue = storage.getItem(legacyKey);
  if (legacyValue === null) return;

  if (storage.getItem(scopedKey) === null) {
    storage.setItem(scopedKey, legacyValue);
  }
  // Removing the unscoped value prevents a second account from claiming it if
  // this account already had a scoped copy from an earlier session.
  storage.removeItem(legacyKey);
}

export function migrateLegacyTrackerStorage(storage: TrackerStorage, accountId: string) {
  const keys = getTrackerStorageKeys(accountId);
  migrateLegacyStorageValue(storage, trackerLocalStorageKey, keys.history);
  migrateLegacyStorageValue(storage, activeGameStorageKey, keys.activeGame);
}

export function readStoredTrackerData(storage: TrackerStorage, accountId: string): StatTrackerData {
  migrateLegacyTrackerStorage(storage, accountId);
  try {
    return normalizeTrackerData(JSON.parse(storage.getItem(getTrackerStorageKeys(accountId).history) ?? '{}'));
  } catch {
    return normalizeTrackerData(null);
  }
}

export function readStoredActiveGame(storage: TrackerStorage, accountId: string): GameSession | null {
  migrateLegacyTrackerStorage(storage, accountId);
  try {
    const value = JSON.parse(storage.getItem(getTrackerStorageKeys(accountId).activeGame) ?? 'null');
    return value && typeof value === 'object' && isSport(value.sport) ? value as GameSession : null;
  } catch {
    return null;
  }
}

export function readStoredTrackerConflict(storage: TrackerStorage, accountId: string): StoredTrackerConflict | null {
  migrateLegacyTrackerStorage(storage, accountId);
  try {
    const value = JSON.parse(storage.getItem(getTrackerStorageKeys(accountId).pendingConflict) ?? 'null') as Partial<StoredTrackerConflict> | null;
    if (
      !value
      || (value.resolution !== null && value.resolution !== 'local' && value.resolution !== 'cloud' && value.resolution !== 'merge')
      || typeof value.cloudProject !== 'object'
      || value.cloudProject === null
      || typeof value.cloudProject.id !== 'string'
      || typeof value.cloudProject.revision !== 'number'
      || !Number.isInteger(value.cloudProject.revision)
      || value.cloudProject.revision < 1
    ) {
      return null;
    }

    return {
      resolution: value.resolution ?? null,
      data: normalizeTrackerData(value.data),
      cloudData: normalizeTrackerData(value.cloudData),
      cloudProject: value.cloudProject,
    };
  } catch {
    return null;
  }
}

export function saveStoredTrackerConflict(storage: TrackerStorage, accountId: string, value: StoredTrackerConflict) {
  storage.setItem(getTrackerStorageKeys(accountId).pendingConflict, JSON.stringify({
    ...value,
    data: normalizeTrackerData(value.data),
    cloudData: normalizeTrackerData(value.cloudData),
  }));
}

export function clearStoredTrackerConflict(storage: TrackerStorage, accountId: string) {
  storage.removeItem(getTrackerStorageKeys(accountId).pendingConflict);
}

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
  softball: {
    id: 'softball',
    label: 'Softball',
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

export function mergeTrackerData(localValue: unknown, cloudValue: unknown): StatTrackerData {
  const local = normalizeTrackerData(localValue);
  const cloud = normalizeTrackerData(cloudValue);
  const localGameIds = new Set(local.games.map((game) => game.id));

  return {
    version: 1,
    games: [
      ...local.games,
      ...cloud.games.filter((game) => !localGameIds.has(game.id)),
    ],
  };
}

export function getPreferredTrackerSport(value: unknown, fallback: Sport): Sport {
  const games = normalizeTrackerData(value).games;
  let preferredSport = fallback;
  let latestTime = Number.NEGATIVE_INFINITY;

  games.forEach((game, index) => {
    const parsedTime = Date.parse(game.endedAt ?? game.startedAt ?? game.date);
    const comparableTime = Number.isFinite(parsedTime) ? parsedTime : index;
    if (comparableTime >= latestTime) {
      latestTime = comparableTime;
      preferredSport = game.sport;
    }
  });

  return preferredSport;
}

export function getTrackerSportForProfile(
  value: unknown,
  profileSport: Sport | null,
  fallback: Sport = 'basketball',
): Sport {
  return profileSport ?? getPreferredTrackerSport(value, fallback);
}

export function trackerPayload(data: StatTrackerData): TrackerPayload {
  return { ...data, tool: 'stat-tracker' };
}

export async function syncTrackerDataToCloud({
  data,
  cloudProject,
  athleteName,
  guestUsageKey,
  client,
}: {
  data: StatTrackerData;
  cloudProject: TrackerCloudProject | null;
  athleteName: string;
  guestUsageKey?: string;
  client: TrackerSyncClient;
}): Promise<TrackerCloudProject> {
  const project = trackerPayload(data);
  if (cloudProject) {
    return client.updateProject({
      projectId: cloudProject.id,
      data: { project, expectedRevision: cloudProject.revision },
    });
  }

  return client.createProject({
    data: {
      name: `${athleteName || 'Athlete'} — Stat Tracker`,
      project,
      guestUsageKey,
    },
  });
}

export function isTrackerRevisionConflict(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 409;
}

export function getTrackerConflict(error: unknown, localData: StatTrackerData): TrackerConflict | null {
  if (!isTrackerRevisionConflict(error) || typeof error !== 'object' || error === null) return null;

  const responseData = (error as { data?: unknown }).data;
  if (typeof responseData !== 'object' || responseData === null) return null;
  const current = (responseData as { current?: unknown }).current;
  if (typeof current !== 'object' || current === null) return null;

  const project = current as { id?: unknown; revision?: unknown; project?: unknown };
  if (
    typeof project.id !== 'string'
    || typeof project.revision !== 'number'
    || !Number.isInteger(project.revision)
    || project.revision < 1
  ) {
    return null;
  }

  return {
    localData: normalizeTrackerData(localData),
    cloudData: normalizeTrackerData(project.project),
    cloudProject: { id: project.id, revision: project.revision },
  };
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

export function buildGameReport(
  games: GameSession[],
  sport: Sport,
  selectedGameId: string,
): GameReport | null {
  const completedGames = games
    .filter((game) => game.sport === sport && game.status === 'final')
    .map((game, index) => ({ game, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.game.startedAt ?? left.game.date);
      const rightTime = Date.parse(right.game.startedAt ?? right.game.date);
      const safeLeftTime = Number.isFinite(leftTime) ? leftTime : left.index;
      const safeRightTime = Number.isFinite(rightTime) ? rightTime : right.index;
      return safeLeftTime - safeRightTime || left.index - right.index;
    })
    .map(({ game }) => game);
  const selectedIndex = completedGames.findIndex((game) => game.id === selectedGameId);
  if (selectedIndex < 0) return null;

  const selectedGame = completedGames[selectedIndex];
  const seasonToDate = seasonTotals(completedGames.slice(0, selectedIndex + 1), sport);
  const divisor = Math.max(1, seasonToDate.gamesPlayed);
  const averageStats = Object.fromEntries(
    Object.entries(seasonToDate.stats).map(([statId, total]) => [statId, total / divisor]),
  );

  return {
    games: completedGames,
    selectedGame,
    selectedIndex,
    previousGame: completedGames[selectedIndex - 1] ?? null,
    seasonToDate,
    averages: {
      score: seasonToDate.score / divisor,
      stats: averageStats,
    },
  };
}

export function trackerSaveErrorMessage(error: unknown): string {
  return isTrackerRevisionConflict(error)
    ? 'This tracker changed elsewhere. Your local history is safe; choose which history to keep before syncing again.'
    : 'Game saved on this device, but cloud sync failed. Try saving again.';
}

export function getTrackerSyncRecovery(error: unknown) {
  const revisionConflict = isTrackerRevisionConflict(error);
  return {
    message: trackerSaveErrorMessage(error),
    revisionConflict,
    retryAvailable: !revisionConflict,
  };
}
