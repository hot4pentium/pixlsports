export type RosterLayout = 'roster' | 'lineup';

export type RosterPlayer = {
  id: string;
  name: string;
  jerseyNumber: string;
  position: string;
  isStarter: boolean;
  isCaptain: boolean;
};

export type RosterDraft = {
  teamName: string;
  season: string;
  layout: RosterLayout;
  players: RosterPlayer[];
};

export const rosterStorageKey = 'leaguematrix-roster-draft';

const defaultPlayers: RosterPlayer[] = [
  { id: 'roster-player-1', name: 'Maya Chen', jerseyNumber: '07', position: 'MID', isStarter: true, isCaptain: true },
  { id: 'roster-player-2', name: 'Jordan Ellis', jerseyNumber: '12', position: 'FWD', isStarter: true, isCaptain: false },
  { id: 'roster-player-3', name: 'Avery Brooks', jerseyNumber: '04', position: 'DEF', isStarter: true, isCaptain: false },
  { id: 'roster-player-4', name: 'Sam Rivera', jerseyNumber: '01', position: 'GK', isStarter: true, isCaptain: false },
  { id: 'roster-player-5', name: 'Noah Patel', jerseyNumber: '18', position: 'MID', isStarter: false, isCaptain: false },
  { id: 'roster-player-6', name: 'Riley Morgan', jerseyNumber: '23', position: 'DEF', isStarter: false, isCaptain: false },
];

let playerCounter = defaultPlayers.length;

export function getDefaultRoster(): RosterDraft {
  return {
    teamName: 'Eastside Falcons',
    season: 'Fall 2024',
    layout: 'roster',
    players: defaultPlayers.map((player) => ({ ...player })),
  };
}

export function createBlankRosterPlayer(): RosterPlayer {
  playerCounter += 1;
  return {
    id: `roster-player-${playerCounter}`,
    name: '',
    jerseyNumber: '',
    position: '',
    isStarter: false,
    isCaptain: false,
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function layoutValue(value: unknown): RosterLayout {
  return value === 'lineup' ? 'lineup' : 'roster';
}

export function normalizeRosterPlayer(value: unknown, fallbackId: string): RosterPlayer {
  const input = typeof value === 'object' && value !== null
    ? value as Partial<RosterPlayer>
    : {};
  return {
    id: stringValue(input.id) || fallbackId,
    name: stringValue(input.name),
    jerseyNumber: stringValue(input.jerseyNumber),
    position: stringValue(input.position),
    isStarter: booleanValue(input.isStarter),
    isCaptain: booleanValue(input.isCaptain),
  };
}

export function normalizeRosterDraft(value: unknown): RosterDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Partial<RosterDraft>;
  if (!Array.isArray(input.players)) return null;
  return {
    teamName: stringValue(input.teamName) || 'Eastside Falcons',
    season: stringValue(input.season) || 'Fall 2024',
    layout: layoutValue(input.layout),
    players: input.players.map((player, index) => (
      normalizeRosterPlayer(player, `roster-player-restored-${index + 1}`)
    )),
  };
}

export function readRosterDraft(storage: Storage = window.localStorage): RosterDraft | null {
  try {
    const stored = storage.getItem(rosterStorageKey);
    return stored ? normalizeRosterDraft(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function saveRosterDraft(storage: Storage, draft: RosterDraft): void {
  storage.setItem(rosterStorageKey, JSON.stringify(draft));
}

export function updateRosterPlayer(
  players: RosterPlayer[],
  id: string,
  patch: Partial<RosterPlayer>,
): RosterPlayer[] {
  return players.map((player) => player.id === id ? { ...player, ...patch, id: player.id } : player);
}

export function removeRosterPlayer(players: RosterPlayer[], id: string): RosterPlayer[] {
  return players.filter((player) => player.id !== id);
}

export function moveRosterPlayer(players: RosterPlayer[], id: string, direction: -1 | 1): RosterPlayer[] {
  const index = players.findIndex((player) => player.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= players.length) return players;
  const reordered = [...players];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  return reordered;
}

export function moveRosterPlayerWithinGroup(
  players: RosterPlayer[],
  id: string,
  direction: -1 | 1,
): RosterPlayer[] {
  const player = players.find((candidate) => candidate.id === id);
  if (!player) return players;

  const groupIndexes = players
    .map((candidate, index) => candidate.isStarter === player.isStarter ? index : -1)
    .filter((index) => index >= 0);
  const groupIndex = groupIndexes.findIndex((index) => players[index].id === id);
  const nextGroupIndex = groupIndex + direction;
  if (groupIndex < 0 || nextGroupIndex < 0 || nextGroupIndex >= groupIndexes.length) return players;

  const reordered = [...players];
  const currentIndex = groupIndexes[groupIndex];
  const nextIndex = groupIndexes[nextGroupIndex];
  [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
  return reordered;
}

export function getStarterPlayers(players: RosterPlayer[]): RosterPlayer[] {
  return players.filter((player) => player.isStarter);
}

export function getBenchPlayers(players: RosterPlayer[]): RosterPlayer[] {
  return players.filter((player) => !player.isStarter);
}

export function filterRosterPlayers(draft: Pick<RosterDraft, 'layout' | 'players'>): RosterPlayer[] {
  return getStarterPlayers(draft.players);
}