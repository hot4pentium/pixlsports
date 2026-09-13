export type RosterLayout = 'roster' | 'lineup';

export type RosterBoardStyle = 'classic' | 'soccer' | 'basketball' | 'baseball';

export type RosterBoardStyleOption = {
  id: RosterBoardStyle;
  label: string;
  description: string;
};

export const rosterBoardStyles: RosterBoardStyleOption[] = [
  { id: 'classic', label: 'Classic grid', description: 'Clean formation grid' },
  { id: 'soccer', label: 'Soccer pitch', description: 'Field lines and boxes' },
  { id: 'basketball', label: 'Basketball court', description: 'Court lines and key' },
  { id: 'baseball', label: 'Baseball diamond', description: 'Diamond and base paths' },
];

export type RosterFormationPosition = {
  x: number;
  y: number;
};

export type RosterPlayer = {
  id: string;
  name: string;
  jerseyNumber: string;
  position: string;
  isStarter: boolean;
  isCaptain: boolean;
  formationPosition: RosterFormationPosition;
};

export type RosterDraft = {
  teamName: string;
  season: string;
  layout: RosterLayout;
  boardStyle: RosterBoardStyle;
  players: RosterPlayer[];
};

export const rosterStorageKey = 'leaguematrix-roster-draft';

const defaultPlayers: RosterPlayer[] = [
  { id: 'roster-player-1', name: 'Maya Chen', jerseyNumber: '07', position: 'MID', isStarter: true, isCaptain: true, formationPosition: { x: 28, y: 68 } },
  { id: 'roster-player-2', name: 'Jordan Ellis', jerseyNumber: '12', position: 'FWD', isStarter: true, isCaptain: false, formationPosition: { x: 72, y: 68 } },
  { id: 'roster-player-3', name: 'Avery Brooks', jerseyNumber: '04', position: 'DEF', isStarter: true, isCaptain: false, formationPosition: { x: 28, y: 38 } },
  { id: 'roster-player-4', name: 'Sam Rivera', jerseyNumber: '01', position: 'GK', isStarter: true, isCaptain: false, formationPosition: { x: 72, y: 38 } },
  { id: 'roster-player-5', name: 'Noah Patel', jerseyNumber: '18', position: 'MID', isStarter: false, isCaptain: false, formationPosition: { x: 32, y: 22 } },
  { id: 'roster-player-6', name: 'Riley Morgan', jerseyNumber: '23', position: 'DEF', isStarter: false, isCaptain: false, formationPosition: { x: 68, y: 22 } },
];

let playerCounter = defaultPlayers.length;

const formationXBounds = { min: 8, max: 92 };
const formationYBounds = { min: 10, max: 90 };
const defaultFormationPositions: RosterFormationPosition[] = [
  { x: 28, y: 68 },
  { x: 72, y: 68 },
  { x: 28, y: 38 },
  { x: 72, y: 38 },
  { x: 38, y: 22 },
  { x: 62, y: 22 },
];

export function getDefaultRoster(): RosterDraft {
  return {
    teamName: 'Eastside Falcons',
    season: 'Fall 2024',
    layout: 'roster',
    boardStyle: 'classic',
    players: defaultPlayers.map((player) => ({ ...player, formationPosition: { ...player.formationPosition } })),
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
    formationPosition: { x: 50, y: 50 },
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getDefaultFormationPosition(index: number): RosterFormationPosition {
  const fallback = defaultFormationPositions[index % defaultFormationPositions.length];
  return { ...fallback };
}

export function normalizeFormationPosition(
  value: unknown,
  fallback: RosterFormationPosition = { x: 50, y: 50 },
): RosterFormationPosition {
  const input = typeof value === 'object' && value !== null
    ? value as Partial<RosterFormationPosition>
    : {};
  return {
    x: clamp(numberValue(input.x, fallback.x), formationXBounds.min, formationXBounds.max),
    y: clamp(numberValue(input.y, fallback.y), formationYBounds.min, formationYBounds.max),
  };
}

export function getPlayerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function layoutValue(value: unknown): RosterLayout {
  return value === 'lineup' ? 'lineup' : 'roster';
}

export function normalizeRosterBoardStyle(value: unknown): RosterBoardStyle {
  return value === 'soccer' || value === 'basketball' || value === 'baseball' ? value : 'classic';
}

export function normalizeRosterPlayer(
  value: unknown,
  fallbackId: string,
  fallbackPosition: RosterFormationPosition = { x: 50, y: 50 },
): RosterPlayer {
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
    formationPosition: normalizeFormationPosition(input.formationPosition, fallbackPosition),
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
    boardStyle: normalizeRosterBoardStyle(input.boardStyle),
    players: input.players.map((player, index) => (
      normalizeRosterPlayer(
        player,
        `roster-player-restored-${index + 1}`,
        getDefaultFormationPosition(index),
      )
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