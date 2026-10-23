export type Sport = 'baseball' | 'basketball' | 'football' | 'soccer' | 'softball' | 'volleyball';
export type GameStatus = 'setup' | 'live' | 'paused' | 'final';

export const YARDAGE_TRACKING_FEATURE_ENABLED = false;
const YARDAGE_TRACKING_SPORTS: readonly Sport[] = ['football'];

export function isYardageTrackingAvailable(sport: Sport) {
  return YARDAGE_TRACKING_FEATURE_ENABLED && YARDAGE_TRACKING_SPORTS.includes(sport);
}

export type StatDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  points: number;
  featured?: boolean;
  liveHidden?: boolean;
};

export type SportRule = {
  id: Sport;
  label: string;
  phaseLabel: string;
  stats: StatDefinition[];
};

export type StatAttribution = 'team' | 'athlete';
export type FootballPossessionSide = 'athlete' | 'opponent';

export type StatEvent = {
  id: string;
  statId: string;
  createdAt: string;
  period: number;
  attribution: StatAttribution;
  possessionSide?: FootballPossessionSide;
  playId?: string;
  yards?: number;
};

export type YardStats = Record<string, number>;
export type GameOutcome = 'win' | 'loss' | 'tie';
export type SoccerPeriodFormat = 'halves' | 'quarters';
export type FinalGameCorrectionInput = {
  score: number;
  opponentScore: number;
  scoreRecorded: boolean;
  outcome: GameOutcome | null;
  stats: Record<string, number>;
  athleteStats: Record<string, number>;
};

export type FinalCorrection = {
  athleteStats: Record<string, number>;
  correctedAt: string;
};

export function outcomeFromScore(score: number, opponentScore: number): GameOutcome {
  return score > opponentScore ? 'win' : score < opponentScore ? 'loss' : 'tie';
}

export function hasRecordedGameScore(game: GameSession): boolean {
  return game.scoreRecorded === true
    || (game.scoreRecorded === undefined && (game.score > 0 || game.opponentScore > 0));
}

export function getGameOutcome(game: GameSession): GameOutcome | null {
  if (game.outcome === 'win' || game.outcome === 'loss' || game.outcome === 'tie') return game.outcome;
  return hasRecordedGameScore(game) ? outcomeFromScore(game.score, game.opponentScore) : null;
}

export type GameSession = {
  id: string;
  sourceEventId?: string;
  sport: Sport;
  status: GameStatus;
  pauseReason?: 'halftime';
  date: string;
  opponent: string;
  period: number;
  soccerPeriodFormat?: SoccerPeriodFormat | null;
  score: number;
  opponentScore: number;
  scoreRecorded?: boolean;
  outcome?: GameOutcome;
  notes: string;
  stats: Record<string, number>;
  possessionSide?: FootballPossessionSide;
  opponentStats?: Record<string, number>;
  trackYards?: boolean;
  yardStats?: YardStats;
  opponentYardStats?: YardStats;
  events: StatEvent[];
  startedAt: string;
  endedAt?: string;
  finalCorrection?: FinalCorrection;
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
  seasonToDateYards: YardStats;
  averages: {
    score: number;
    stats: Record<string, number>;
    yards: YardStats;
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

export type TrackerSaveStatus = 'saving' | 'cloud-saved' | 'local-saved';

export type StoredTrackerConflict = {
  resolution: TrackerConflictResolution | null;
  data: StatTrackerData;
  cloudData: StatTrackerData;
  cloudProject: TrackerCloudProject;
};

export type StoredTrackerSyncFailure = 'retry' | 'revision-conflict';

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
    pendingSyncFailure: `${trackerLocalStorageKey}:pending-sync-failure:${suffix}`,
  };
}

export function getTrackerFavoriteStorageKey(accountId: string, sport: Sport) {
  return `${trackerLocalStorageKey}:favorites:${encodeURIComponent(accountId)}:${sport}`;
}

export function readStoredTrackerFavorites(
  storage: TrackerStorage,
  accountId: string,
  sport: Sport,
  validStatIds: readonly string[],
): string[] {
  try {
    const stored = JSON.parse(storage.getItem(getTrackerFavoriteStorageKey(accountId, sport)) ?? '[]');
    if (!Array.isArray(stored)) return [];
    const valid = new Set(validStatIds);
    const normalized = stored.flatMap((id) => {
      if (sport === 'football' && id === 'pass-reception') {
        return ['pass-yard', 'reception'].filter((statId) => valid.has(statId));
      }
      return typeof id === 'string' && valid.has(id) ? [id] : [];
    });
    return [...new Set(normalized)];
  } catch {
    return [];
  }
}

export function saveStoredTrackerFavorites(
  storage: TrackerStorage,
  accountId: string,
  sport: Sport,
  favoriteStatIds: readonly string[],
  validStatIds: readonly string[],
) {
  const valid = new Set(validStatIds);
  const favorites = [...new Set(favoriteStatIds.filter((id) => valid.has(id)))];
  storage.setItem(getTrackerFavoriteStorageKey(accountId, sport), JSON.stringify(favorites));
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
    return value && typeof value === 'object' && isSport(value.sport)
      ? normalizeGameSession(value as GameSession)
      : null;
  } catch {
    return null;
  }
}

export function saveStoredActiveGame(storage: TrackerStorage, accountId: string, game: GameSession | null) {
  const key = getTrackerStorageKeys(accountId).activeGame;
  if (game) storage.setItem(key, JSON.stringify(normalizeGameSession(game)));
  else storage.removeItem(key);
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

export function readStoredTrackerSyncFailure(
  storage: TrackerStorage,
  accountId: string,
): StoredTrackerSyncFailure | null {
  const value = storage.getItem(getTrackerStorageKeys(accountId).pendingSyncFailure);
  return value === 'retry' || value === 'revision-conflict' ? value : null;
}

export function saveStoredTrackerSyncFailure(
  storage: TrackerStorage,
  accountId: string,
  failure: StoredTrackerSyncFailure,
) {
  storage.setItem(getTrackerStorageKeys(accountId).pendingSyncFailure, failure);
}

export function clearStoredTrackerSyncFailure(storage: TrackerStorage, accountId: string) {
  storage.removeItem(getTrackerStorageKeys(accountId).pendingSyncFailure);
}

const stat = (
  id: string,
  label: string,
  shortLabel: string,
  points: number,
  featured = true,
  liveHidden = false,
): StatDefinition => ({ id, label, shortLabel, points, featured, liveHidden });

export const baseballHitChoices = [
  { id: 'single', label: 'Single', shortLabel: '1B' },
  { id: 'double', label: 'Double', shortLabel: '2B' },
  { id: 'triple', label: 'Triple', shortLabel: '3B' },
] as const;

export const baseballPitchChoices = [
  { id: 'fastball', label: 'Fastball', shortLabel: 'FB' },
  { id: 'changeup', label: 'Changeup', shortLabel: 'CHG' },
  { id: 'slider', label: 'Slider', shortLabel: 'SL' },
  { id: 'strikeout', label: 'Strike (K)', shortLabel: 'K' },
  { id: 'curveball', label: 'Curveball', shortLabel: 'CB' },
] as const;

export const footballYardMetricDefinitions = [
  { id: 'pass-yard', label: 'Passing yards', shortLabel: 'PASS YDS' },
  { id: 'rush-yard', label: 'Rushing yards', shortLabel: 'RUSH YDS' },
  { id: 'receiving-yard', label: 'Receiving yards', shortLabel: 'REC YDS' },
] as const;

export type FootballYardMetricId = typeof footballYardMetricDefinitions[number]['id'];

export function getFootballYardMetricId(statId: string): FootballYardMetricId | null {
  if (statId === 'pass-yard' || statId === 'rush-yard') return statId;
  if (statId === 'reception') return 'receiving-yard';
  return null;
}

export function adjustYardValue(value: number, delta: number): number {
  const current = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return Math.max(0, current + delta);
}

function normalizeYardStats(value: unknown): YardStats {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))
      .map(([statId, amount]) => [statId, Math.max(0, Math.floor(amount as number))]),
  );
}

function normalizeGameSession(game: GameSession): GameSession {
  const {
    soccerPeriodFormat: _untrustedFormat,
    sourceEventId: _untrustedSourceEventId,
    finalCorrection: _untrustedCorrection,
    pauseReason: _untrustedPauseReason,
    possessionSide: _untrustedPossessionSide,
    opponentStats: _untrustedOpponentStats,
    opponentYardStats: _untrustedOpponentYardStats,
    ...rest
  } = game;
  const finalCorrection = normalizeFinalCorrection(game.finalCorrection, game.sport, game.stats);
  return {
    ...rest,
    ...(game.status === 'paused' && game.pauseReason === 'halftime' ? { pauseReason: 'halftime' as const } : {}),
    ...(typeof game.sourceEventId === 'string' && game.sourceEventId.trim()
      ? { sourceEventId: game.sourceEventId }
      : {}),
    ...(game.sport === 'soccer' && (
      game.soccerPeriodFormat === 'halves'
      || game.soccerPeriodFormat === 'quarters'
      || game.soccerPeriodFormat === null
    ) ? { soccerPeriodFormat: game.soccerPeriodFormat } : {}),
    ...(game.sport === 'football' ? {
      possessionSide: game.possessionSide === 'opponent' ? 'opponent' as const : 'athlete' as const,
      opponentStats: normalizeYardStats(game.opponentStats),
      opponentYardStats: normalizeYardStats(game.opponentYardStats),
    } : {}),
    trackYards: game.sport === 'football' && game.trackYards === true,
    yardStats: normalizeYardStats(game.yardStats),
    ...(finalCorrection ? { finalCorrection } : {}),
    events: Array.isArray(game.events)
      ? game.events.map((event) => {
        const { possessionSide: _untrustedEventPossessionSide, ...eventRest } = event;
        return {
          ...eventRest,
          attribution: event.attribution === 'athlete' ? 'athlete' : 'team',
          ...(game.sport === 'football' ? {
            possessionSide: event.possessionSide === 'opponent' ? 'opponent' as const : 'athlete' as const,
          } : {}),
          ...(typeof event.playId === 'string' && event.playId.length > 0 ? { playId: event.playId } : {}),
          ...(typeof event.yards === 'number' && Number.isFinite(event.yards)
            ? { yards: Math.max(0, Math.floor(event.yards)) }
            : {}),
        };
      })
      : [],
  };
}

function isStatCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function normalizeFinalCorrection(
  value: unknown,
  sport: Sport,
  stats: Record<string, number>,
): FinalCorrection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!stats || typeof stats !== 'object' || !sportRules[sport]) return undefined;
  const correction = value as { athleteStats?: unknown; correctedAt?: unknown };
  if (typeof correction.correctedAt !== 'string' || !Number.isFinite(Date.parse(correction.correctedAt))) {
    return undefined;
  }
  if (!correction.athleteStats || typeof correction.athleteStats !== 'object' || Array.isArray(correction.athleteStats)) {
    return undefined;
  }
  const allowedIds = new Set(sportRules[sport].stats.map(({ id }) => id));
  const athleteStats: Record<string, number> = {};
  for (const [statId, count] of Object.entries(correction.athleteStats)) {
    if (!allowedIds.has(statId) || !isStatCount(count) || count > (stats[statId] ?? 0)) return undefined;
    athleteStats[statId] = count;
  }
  return { athleteStats, correctedAt: new Date(correction.correctedAt).toISOString() };
}

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
      stat('pass', 'Pass', 'PASS', 0),
      stat('header', 'Header', 'HEAD', 0),
      stat('clearance', 'Clearance', 'CLR', 0),
      stat('corner-kick', 'Corner Kick', 'CK', 0),
      stat('penalty-kick', 'Penalty Kick', 'PK', 0),
      stat('save', 'Save', 'SAVE', 0),
      stat('yellow-card', 'Yellow card', 'YC', 0),
      stat('red-card', 'Red Card', 'RC', 0),
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
      stat('interception', 'Interception', 'INT', 0),
      stat('tackle', 'Tackle', 'TACKLE', 0),
      stat('reception', 'Reception', 'REC', 0),
      stat('first-down', 'First Down', '1ST DOWN', 0),
      stat('sack', 'Sack', 'SACK', 0),
    ],
  },
  baseball: {
    id: 'baseball',
    label: 'Baseball',
    phaseLabel: 'Inning',
    stats: [
      stat('run', 'Run', 'RUN', 1),
      stat('hit', 'Hit', 'HIT', 0),
      stat('single', 'Single', '1B', 0, false, true),
      stat('double', 'Double', '2B', 0, false, true),
      stat('triple', 'Triple', '3B', 0, false, true),
      stat('rbi', 'Run batted in', 'RBI', 1),
      stat('home-run', 'Home run', 'HR', 4),
      stat('strikeout', 'Strikeout', 'K', 0, false, true),
      stat('walk', 'Walk', 'BB', 0),
      stat('stolen-base', 'Stolen base', 'SB', 0, false),
      stat('pitch', 'Pitch', 'PITCH', 0),
      stat('fastball', 'Fastball', 'FB', 0, false, true),
      stat('changeup', 'Changeup', 'CHG', 0, false, true),
      stat('slider', 'Slider', 'SL', 0, false, true),
      stat('curveball', 'Curveball', 'CB', 0, false, true),
      // Keep older pitch classifications readable without offering them as new choices.
      stat('four-seam-fastball', 'Four-seam fastball', '4SFB', 0, false, true),
      stat('two-seam-fastball', 'Two-seam fastball', '2SFB', 0, false, true),
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

/** Share live-card labels while keeping the full tracker able to use separate football stat IDs. */
export function getLiveTrackingStats(
  sport: Sport,
  stats: StatDefinition[],
  options: { combinePassReception?: boolean } = {},
): StatDefinition[] {
  if (sport !== 'football') return stats;
  if (options.combinePassReception === false) {
    return stats.map((item) => {
      if (item.id === 'pass-yard') return { ...item, label: 'Pass', shortLabel: 'PASS' };
      if (item.id === 'rush-yard') return { ...item, label: 'Rush', shortLabel: 'RUSH' };
      return item;
    });
  }
  return stats.filter((item) => item.id !== 'reception').map((item) => {
    if (item.id === 'pass-yard') {
      return { ...item, id: 'pass-reception', label: 'Pass/Rec', shortLabel: 'PASS/REC' };
    }
    if (item.id === 'rush-yard') {
      return { ...item, label: 'Rush', shortLabel: 'RUSH' };
    }
    return item;
  });
}

export function getGamePhaseLabel(game: GameSession): string {
  return game.sport === 'soccer' && game.soccerPeriodFormat === 'quarters'
    ? 'Quarter'
    : getSportRule(game.sport).phaseLabel;
}

export function advanceGamePeriod(game: GameSession): GameSession {
  if (game.status === 'final' || (game.sport === 'soccer' && game.soccerPeriodFormat === null)) return game;
  return { ...game, period: game.period + 1 };
}

export function isSport(value: unknown): value is Sport {
  return typeof value === 'string' && sports.includes(value as Sport);
}

export function createGameSession(
  sport: Sport,
  input: { date?: string; opponent?: string; notes?: string; sourceEventId?: string; soccerPeriodFormat?: SoccerPeriodFormat | null },
  now = new Date(),
): GameSession {
  return {
    id: `tracker-game-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
    sport,
    status: 'live',
    date: input.date ?? now.toISOString().slice(0, 10),
    opponent: input.opponent?.trim() ?? '',
    period: 1,
    ...(sport === 'soccer' && 'soccerPeriodFormat' in input ? { soccerPeriodFormat: input.soccerPeriodFormat } : {}),
    score: 0,
    opponentScore: 0,
    scoreRecorded: false,
    ...(sport === 'football' ? {
      possessionSide: 'athlete' as const,
      opponentStats: {},
      opponentYardStats: {},
    } : {}),
    notes: input.notes?.trim() ?? '',
    stats: {},
    trackYards: sport === 'football',
    yardStats: {},
    events: [],
    startedAt: now.toISOString(),
  };
}

export function adjustScore(
  game: GameSession,
  side: 'athlete' | 'opponent',
  delta: number,
): GameSession {
  if (game.status !== 'live' || !Number.isFinite(delta) || delta === 0) return game;
  const nextScore = Math.max(0, (side === 'athlete' ? game.score : game.opponentScore) + delta);
  return side === 'athlete'
    ? { ...game, score: nextScore, scoreRecorded: true }
    : { ...game, opponentScore: nextScore, scoreRecorded: true };
}

export function setFootballPossessionSide(
  game: GameSession,
  possessionSide: FootballPossessionSide,
): GameSession {
  if (game.sport !== 'football' || game.status === 'final' || game.possessionSide === possessionSide) return game;
  return { ...game, possessionSide };
}

export function addStatEvent(
  game: GameSession,
  statId: string,
  now = new Date(),
  yards = 0,
  attribution: StatAttribution = 'team',
  playId?: string,
  possessionSide: FootballPossessionSide = game.possessionSide ?? 'athlete',
): GameSession {
  const definition = getSportRule(game.sport).stats.find((item) => item.id === statId);
  if (!definition || game.status !== 'live') return game;
  const yardMetricId = game.sport === 'football' && game.trackYards
    ? getFootballYardMetricId(statId)
    : null;
  const eventYards = yardMetricId
    ? Math.max(0, Math.floor(Number.isFinite(yards) ? yards : 0))
    : 0;
  const eventPossessionSide: FootballPossessionSide = game.sport === 'football' && possessionSide === 'opponent'
    ? 'opponent'
    : 'athlete';
  const isOpponentPlay = game.sport === 'football' && eventPossessionSide === 'opponent';
  const event: StatEvent = {
    id: `tracker-event-${now.getTime()}-${game.events.length}`,
    statId,
    createdAt: now.toISOString(),
    period: game.period,
    attribution,
    ...(game.sport === 'football' ? { possessionSide: eventPossessionSide } : {}),
    ...(playId ? { playId } : {}),
    ...(eventYards > 0 ? { yards: eventYards } : {}),
  };
  const yardStats = { ...(game.yardStats ?? {}) };
  const opponentYardStats = { ...(game.opponentYardStats ?? {}) };
  if (yardMetricId && eventYards > 0) {
    const targetYardStats = isOpponentPlay ? opponentYardStats : yardStats;
    targetYardStats[yardMetricId] = (targetYardStats[yardMetricId] ?? 0) + eventYards;
  }
  const opponentStats = { ...(game.opponentStats ?? {}) };
  if (isOpponentPlay) opponentStats[statId] = (opponentStats[statId] ?? 0) + 1;
  return {
    ...game,
    stats: isOpponentPlay ? game.stats : { ...game.stats, [statId]: (game.stats[statId] ?? 0) + 1 },
    ...(game.sport === 'football' ? { opponentStats, opponentYardStats, possessionSide: eventPossessionSide } : {}),
    yardStats,
    score: isOpponentPlay ? game.score : game.score + definition.points,
    opponentScore: isOpponentPlay ? game.opponentScore + definition.points : game.opponentScore,
    scoreRecorded: ((attribution === 'team' || isOpponentPlay) && definition.points > 0) ? true : game.scoreRecorded,
    events: [...game.events, event],
  };
}

export function addAthleteStatEvent(
  game: GameSession,
  statId: string,
  now = new Date(),
): GameSession {
  const withEvent = addStatEvent(game, statId, now, 0, 'athlete', undefined, 'athlete');
  return withEvent === game ? game : { ...withEvent, score: game.score, scoreRecorded: game.scoreRecorded };
}

export type AthleteResultCapture = {
  date: string;
  opponent: string;
  score: number;
  opponentScore: number;
  outcome?: GameOutcome;
  notes: string;
  stats: Record<string, number>;
};

export function createAthleteResultGame(
  sport: Sport,
  capture: AthleteResultCapture,
  now = new Date(),
): GameSession {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capture.date)) {
    throw new Error('Choose a valid game date.');
  }
  if (
    !Number.isInteger(capture.score)
    || capture.score < 0
    || !Number.isInteger(capture.opponentScore)
    || capture.opponentScore < 0
  ) {
    throw new Error('Scores must be whole numbers greater than or equal to zero.');
  }

  let game = createGameSession(sport, {
    date: capture.date,
    opponent: capture.opponent,
    notes: capture.notes,
  }, now);
  for (const [statId, count] of Object.entries(capture.stats)) {
    if (!Number.isInteger(count) || count < 1 || count > 99) continue;
    for (let index = 0; index < count; index += 1) {
      game = addAthleteStatEvent(game, statId, now);
    }
  }
  return endGame({
    ...game,
    score: capture.score,
    opponentScore: capture.opponentScore,
    scoreRecorded: true,
    ...(capture.outcome ? { outcome: capture.outcome } : {}),
  }, now);
}

export function addFootballPassReception(
  game: GameSession,
  now = new Date(),
  yards = 0,
  attribution: StatAttribution = 'team',
  possessionSide: FootballPossessionSide = game.possessionSide ?? 'athlete',
): GameSession {
  if (game.sport !== 'football') return game;
  const playId = `tracker-play-${now.getTime()}-${game.events.length}`;
  const withPass = addStatEvent(game, 'pass-yard', now, yards, attribution, playId, possessionSide);
  return addStatEvent(withPass, 'reception', now, yards, attribution, playId, possessionSide);
}

export function countStatEventsByAttribution(
  game: Pick<GameSession, 'events'> & Partial<Pick<GameSession, 'status' | 'stats' | 'finalCorrection'>>,
  statIds: string | readonly string[],
): Record<StatAttribution, number> {
  const ids = new Set(Array.isArray(statIds) ? statIds : [statIds]);
  if (game.status === 'final' && game.finalCorrection && game.stats) {
    let athlete = 0;
    let total = 0;
    for (const statId of ids) {
      const statTotal = game.stats[statId] ?? 0;
      const athleteTotal = game.finalCorrection.athleteStats[statId] ?? 0;
      total += statTotal;
      athlete += athleteTotal;
    }
    return { team: total - athlete, athlete };
  }
  return game.events.reduce<Record<StatAttribution, number>>((counts, event) => {
    if (event.possessionSide === 'opponent') return counts;
    if (ids.has(event.statId)) counts[event.attribution === 'athlete' ? 'athlete' : 'team'] += 1;
    return counts;
  }, { team: 0, athlete: 0 });
}

export function updateStatEventAttribution(
  game: GameSession,
  eventId: string,
  attribution: StatAttribution,
): GameSession {
  if (game.status !== 'live') return game;
  const eventIndex = game.events.findIndex((event) => event.id === eventId);
  if (
    eventIndex < 0
    || game.events[eventIndex]?.possessionSide === 'opponent'
    || game.events[eventIndex]?.attribution === attribution
  ) return game;

  return {
    ...game,
    events: game.events.map((event, index) => (
      index === eventIndex ? { ...event, attribution } : event
    )),
  };
}

export function updateStatEventYards(
  game: GameSession,
  eventId: string,
  yards: number,
): GameSession {
  if (game.status !== 'live' || game.sport !== 'football' || game.trackYards !== true) return game;
  const event = game.events.find((item) => item.id === eventId);
  const yardMetricId = event ? getFootballYardMetricId(event.statId) : null;
  if (!event || !yardMetricId) return game;

  const nextYards = Math.max(0, Math.floor(Number.isFinite(yards) ? yards : 0));
  const pairedPlayId = event.playId;
  const pairedEvents = pairedPlayId
    ? game.events.filter((item) => item.playId === pairedPlayId)
    : [event];
  const affectedMetricIds = new Set(
    pairedEvents
      .map((item) => getFootballYardMetricId(item.statId))
      .filter((metricId): metricId is FootballYardMetricId => Boolean(metricId)),
  );
  const events = game.events.map((item) => {
    if (pairedPlayId ? item.playId !== pairedPlayId : item.id !== eventId) return item;
    if (nextYards > 0) return { ...item, yards: nextYards };
    const nextEvent = { ...item };
    delete nextEvent.yards;
    return nextEvent;
  });
  const targetYardStats = event.possessionSide === 'opponent'
    ? { ...(game.opponentYardStats ?? {}) }
    : { ...(game.yardStats ?? {}) };
  affectedMetricIds.forEach((metricId) => {
    const nextTotal = events.reduce((total, item) => (
      item.possessionSide === event.possessionSide && getFootballYardMetricId(item.statId) === metricId
        ? total + (item.yards ?? 0)
        : total
    ), 0);
    if (nextTotal === 0) delete targetYardStats[metricId];
    else targetYardStats[metricId] = nextTotal;
  });

  return {
    ...game,
    ...(event.possessionSide === 'opponent'
      ? { opponentYardStats: targetYardStats }
      : { yardStats: targetYardStats }),
    events,
  };
}

export function undoStatEvent(game: GameSession, eventId: string): GameSession {
  const event = game.events.find((item) => item.id === eventId);
  if (!event || game.status === 'final') return game;
  const removedEvents = event.playId
    ? game.events.filter((item) => item.playId === event.playId)
    : [event];
  const removedEventIds = new Set(removedEvents.map((item) => item.id));
  const stats = { ...game.stats };
  const opponentStats = { ...(game.opponentStats ?? {}) };
  const teamYardMetricTotals = new Map<FootballYardMetricId, number>();
  const opponentYardMetricTotals = new Map<FootballYardMetricId, number>();
  let scoreDelta = 0;
  let opponentScoreDelta = 0;
  removedEvents.forEach((removedEvent) => {
    const isOpponentPlay = game.sport === 'football' && removedEvent.possessionSide === 'opponent';
    const targetStats = isOpponentPlay ? opponentStats : stats;
    const nextCount = Math.max(0, (targetStats[removedEvent.statId] ?? 0) - 1);
    if (nextCount === 0) delete targetStats[removedEvent.statId];
    else targetStats[removedEvent.statId] = nextCount;
    const definition = getSportRule(game.sport).stats.find((item) => item.id === removedEvent.statId);
    if (isOpponentPlay) opponentScoreDelta += definition?.points ?? 0;
    else scoreDelta += definition?.points ?? 0;
    const yardMetricId = game.sport === 'football' ? getFootballYardMetricId(removedEvent.statId) : null;
    if (yardMetricId && removedEvent.yards) {
      const totals = isOpponentPlay ? opponentYardMetricTotals : teamYardMetricTotals;
      totals.set(yardMetricId, (totals.get(yardMetricId) ?? 0) + removedEvent.yards);
    }
  });
  const yardStats = { ...(game.yardStats ?? {}) };
  teamYardMetricTotals.forEach((removedYards, yardMetricId) => {
    const nextYards = Math.max(0, (yardStats[yardMetricId] ?? 0) - removedYards);
    if (nextYards === 0) delete yardStats[yardMetricId];
    else yardStats[yardMetricId] = nextYards;
  });
  const opponentYardStats = { ...(game.opponentYardStats ?? {}) };
  opponentYardMetricTotals.forEach((removedYards, yardMetricId) => {
    const nextYards = Math.max(0, (opponentYardStats[yardMetricId] ?? 0) - removedYards);
    if (nextYards === 0) delete opponentYardStats[yardMetricId];
    else opponentYardStats[yardMetricId] = nextYards;
  });
  return {
    ...game,
    stats,
    ...(game.sport === 'football' ? { opponentStats, opponentYardStats } : {}),
    yardStats,
    score: Math.max(0, game.score - scoreDelta),
    opponentScore: Math.max(0, game.opponentScore - opponentScoreDelta),
    events: game.events.filter((item) => !removedEventIds.has(item.id)),
  };
}

export function undoLastStatEvent(game: GameSession): GameSession {
  const event = game.events.at(-1);
  return event ? undoStatEvent(game, event.id) : game;
}

export function endGame(
  game: GameSession,
  now = new Date(),
  scoreRecorded = game.scoreRecorded ?? false,
): GameSession {
  if (game.status === 'final') return game;
  const { pauseReason: _pauseReason, ...gameWithoutPauseReason } = game;
  return { ...gameWithoutPauseReason, status: 'final', scoreRecorded, endedAt: now.toISOString() };
}

export function pauseGame(game: GameSession, reason?: GameSession['pauseReason']): GameSession {
  if (game.status === 'paused' || game.status === 'final') return game;
  const { pauseReason: _pauseReason, ...gameWithoutPauseReason } = game;
  return {
    ...gameWithoutPauseReason,
    status: 'paused',
    ...(reason ? { pauseReason: reason } : {}),
  };
}

export function resumeGame(game: GameSession): GameSession {
  if (game.status !== 'paused') return game;
  const { pauseReason: _pauseReason, ...gameWithoutPauseReason } = game;
  return { ...gameWithoutPauseReason, status: 'live' };
}

export function applyFinalGameCorrection(
  game: GameSession,
  input: FinalGameCorrectionInput,
  now = new Date(),
): GameSession {
  if (game.status !== 'final') throw new Error('Only final games can be corrected.');
  const isOutcome = input.outcome === null
    || input.outcome === 'win'
    || input.outcome === 'loss'
    || input.outcome === 'tie';
  if (!isOutcome) throw new Error('Outcome must be win, loss, tie, or null.');
  if (typeof input.scoreRecorded !== 'boolean') throw new Error('Score-recorded flag must be true or false.');
  if (!isStatCount(input.score) || !isStatCount(input.opponentScore)) {
    throw new Error('Scores must be finite nonnegative integers.');
  }
  const allowedIds = new Set(sportRules[game.sport].stats.map(({ id }) => id));
  const validateStats = (stats: unknown, label: string): Record<string, number> => {
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      throw new Error(`${label} must be a stat-count object.`);
    }
    const result: Record<string, number> = {};
    for (const [statId, count] of Object.entries(stats)) {
      if (!allowedIds.has(statId)) throw new Error(`Stat "${statId}" is not valid for ${game.sport}.`);
      if (!isStatCount(count)) throw new Error(`Stat "${statId}" must be a finite nonnegative integer.`);
      result[statId] = count;
    }
    return result;
  };
  const stats = validateStats(input.stats, 'Stats');
  const athleteStats = validateStats(input.athleteStats, 'Athlete stats');
  for (const [statId, count] of Object.entries(athleteStats)) {
    if (count > (stats[statId] ?? 0)) {
      throw new Error(`Athlete ${statId} total cannot exceed the combined total.`);
    }
  }
  if (input.scoreRecorded && input.outcome && outcomeFromScore(input.score, input.opponentScore) !== input.outcome) {
    throw new Error('Explicit outcome must match the recorded score.');
  }
  const outcome = input.outcome ?? (input.scoreRecorded
    ? outcomeFromScore(input.score, input.opponentScore)
    : undefined);
  const { outcome: _previousOutcome, ...gameWithoutOutcome } = game;
  return {
    ...gameWithoutOutcome,
    score: input.score,
    opponentScore: input.opponentScore,
    scoreRecorded: input.scoreRecorded,
    ...(outcome ? { outcome } : {}),
    stats,
    finalCorrection: { athleteStats, correctedAt: now.toISOString() },
  };
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
    .map((game) => {
      const { outcome: _untrustedOutcome, ...normalized } = normalizeGameSession(game);
      return {
        ...normalized,
        opponentScore: typeof game.opponentScore === 'number' ? Math.max(0, game.opponentScore) : 0,
        notes: typeof game.notes === 'string' ? game.notes : '',
        ...(game.outcome === 'win' || game.outcome === 'loss' || game.outcome === 'tie'
          ? { outcome: game.outcome }
          : {}),
      };
    })
    : [];
  return { version: 1, games };
}

function sameRecordedPlays(local: GameSession, cloud: GameSession): boolean {
  return JSON.stringify(local.events) === JSON.stringify(cloud.events)
    && JSON.stringify(local.yardStats ?? {}) === JSON.stringify(cloud.yardStats ?? {});
}

export function hasDivergentCorrectedFinalHistory(localValue: unknown, cloudValue: unknown): boolean {
  const local = normalizeTrackerData(localValue);
  const cloudById = new Map(normalizeTrackerData(cloudValue).games.map((game) => [game.id, game]));
  return local.games.some((game) => {
    const cloudGame = cloudById.get(game.id);
    if (game.status !== 'final' || cloudGame?.status !== 'final') return false;
    const cloudCorrection = Date.parse(cloudGame.finalCorrection?.correctedAt ?? '') || 0;
    const localCorrection = Date.parse(game.finalCorrection?.correctedAt ?? '') || 0;
    return cloudCorrection > 0 && cloudCorrection >= localCorrection && !sameRecordedPlays(game, cloudGame);
  });
}

export function mergeTrackerData(localValue: unknown, cloudValue: unknown): StatTrackerData {
  const local = normalizeTrackerData(localValue);
  const cloud = normalizeTrackerData(cloudValue);
  const localGameIds = new Set(local.games.map((game) => game.id));
  const cloudById = new Map(cloud.games.map((game) => [game.id, game]));

  return {
    version: 1,
    games: [
      ...local.games.map((game) => {
        const cloudGame = cloudById.get(game.id);
        const cloudCorrection = Date.parse(cloudGame?.finalCorrection?.correctedAt ?? '') || 0;
        const localCorrection = Date.parse(game.finalCorrection?.correctedAt ?? '') || 0;
        // Use a newer cloud correction only when the recorded plays are identical.
        // Divergent finals need an explicit history choice before cloud sync.
        return game.status === 'final' && cloudGame?.status === 'final'
          && cloudCorrection > 0 && cloudCorrection >= localCorrection
          && sameRecordedPlays(game, cloudGame)
          ? cloudGame
          : game;
      }),
      ...cloud.games.filter((game) => !localGameIds.has(game.id)),
    ],
  };
}

export function reconcileTrackerDataForSync(
  localData: StatTrackerData,
  cloudProject: { id: string; revision: number; project: unknown } | null,
  confirmedChoice: TrackerConflictResolution | null = null,
): StatTrackerData {
  if (!cloudProject) return localData;
  if (hasDivergentCorrectedFinalHistory(localData, cloudProject.project)
    && confirmedChoice !== 'local' && confirmedChoice !== 'cloud') {
    throw Object.assign(new Error('Local plays and a cloud correction differ.'), {
      status: 409,
      data: { current: cloudProject },
    });
  }
  return confirmedChoice === 'local' || confirmedChoice === 'cloud'
    ? localData
    : mergeTrackerData(localData, cloudProject.project);
}

/** Cloud history is authoritative for shared IDs; device-only games remain visible. */
export function combineTrackerReviewHistory(localValue: unknown, cloudValue: unknown): StatTrackerData {
  const local = normalizeTrackerData(localValue);
  const cloud = normalizeTrackerData(cloudValue);
  const merged = new Map<string, GameSession>(cloud.games.map((game) => [game.id, game]));
  for (const game of local.games) {
    if (!merged.has(game.id)) merged.set(game.id, game);
  }
  return { version: 1, games: [...merged.values()] };
}

export function getPreferredTrackerSport(value: unknown, fallback?: Sport): Sport | null {
  const games = normalizeTrackerData(value).games;
  let preferredSport: Sport | null = fallback ?? null;
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
  fallback?: Sport,
): Sport | null {
  return profileSport ?? getPreferredTrackerSport(value, fallback);
}

export function getTrackerSportForSession(
  value: unknown,
  profileSport: Sport | null,
  activeGameSport?: Sport | null,
): Sport | null {
  // The profile selects new work, not the rules of an already-recorded game.
  return activeGameSport ?? profileSport ?? getPreferredTrackerSport(value);
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
    if (hasRecordedGameScore(game)) score += game.score;
    for (const [statId, count] of Object.entries(game.stats)) {
      totals[statId] = (totals[statId] ?? 0) + count;
    }
  }
  return { gamesPlayed, score, stats: totals };
}

export function seasonYardTotals(games: GameSession[], sport: Sport): YardStats {
  const totals: YardStats = {};
  for (const game of games) {
    if (game.sport !== sport || game.status !== 'final') continue;
    for (const [statId, yards] of Object.entries(game.yardStats ?? {})) {
      totals[statId] = (totals[statId] ?? 0) + yards;
    }
  }
  return totals;
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
  const seasonToDateYards = seasonYardTotals(completedGames.slice(0, selectedIndex + 1), sport);
  const divisor = Math.max(1, seasonToDate.gamesPlayed);
  const scoredGameCount = Math.max(1, completedGames.slice(0, selectedIndex + 1).filter(hasRecordedGameScore).length);
  const averageStats = Object.fromEntries(
    Object.entries(seasonToDate.stats).map(([statId, total]) => [statId, total / divisor]),
  );
  const averageYards = Object.fromEntries(
    Object.entries(seasonToDateYards).map(([statId, total]) => [statId, total / divisor]),
  );

  return {
    games: completedGames,
    selectedGame,
    selectedIndex,
    previousGame: completedGames[selectedIndex - 1] ?? null,
    seasonToDate,
    seasonToDateYards,
    averages: {
      score: seasonToDate.score / scoredGameCount,
      stats: averageStats,
      yards: averageYards,
    },
  };
}

export function trackerSaveErrorMessage(error: unknown): string {
  return isTrackerRevisionConflict(error)
    ? 'This tracker changed elsewhere. Your local history is safe; choose which history to keep before syncing again.'
    : 'Game saved on this device, but cloud sync failed. Try saving again.';
}

export function trackerSaveStatusMessage(status: TrackerSaveStatus): string {
  switch (status) {
    case 'saving':
      return 'Saving game to cloud…';
    case 'cloud-saved':
      return 'Game saved to cloud';
    case 'local-saved':
      return 'Saved on this device — cloud sync needs attention';
  }
}

export function getTrackerSyncRecovery(error: unknown) {
  const revisionConflict = isTrackerRevisionConflict(error);
  return {
    message: trackerSaveErrorMessage(error),
    revisionConflict,
    retryAvailable: !revisionConflict,
  };
}
