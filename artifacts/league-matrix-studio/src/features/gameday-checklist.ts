export type ChecklistMode = 'gameday' | 'tournament';

export type GamedayChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  section?: string | null;
};

export type LocalGamedayChecklist = {
  title: string;
  mode: ChecklistMode;
  items: GamedayChecklistItem[];
  shareToken?: string;
  revision?: number;
};

export const gamedayChecklistStorageKey = 'pixlsports-gameday-checklist';

export const gamedayChecklistTemplate: GamedayChecklistItem[] = [
  { id: 'uniform', label: 'Pack the uniform and game shoes', completed: false, section: 'Before leaving' },
  { id: 'equipment', label: 'Pack equipment and team bag', completed: false, section: 'Before leaving' },
  { id: 'water', label: 'Bring water and a quick snack', completed: false, section: 'Before leaving' },
  { id: 'arrival', label: 'Confirm arrival time and location', completed: false, section: 'Team details' },
  { id: 'lineup', label: 'Check the lineup and player availability', completed: false, section: 'Team details' },
  { id: 'schedule', label: 'Review the game schedule and field or court', completed: false, section: 'Team details' },
];

export function createGamedayChecklist(): LocalGamedayChecklist {
  return {
    title: 'Gameday Checklist',
    mode: 'gameday',
    items: gamedayChecklistTemplate.map((item) => ({ ...item })),
  };
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function normalizeChecklist(value: unknown): LocalGamedayChecklist | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Partial<LocalGamedayChecklist>;
  if (!Array.isArray(input.items)) return null;
  const items = input.items
    .filter((item): item is GamedayChecklistItem => (
      typeof item === 'object'
      && item !== null
      && typeof (item as GamedayChecklistItem).id === 'string'
      && typeof (item as GamedayChecklistItem).label === 'string'
    ))
    .map((item) => ({
      id: item.id,
      label: item.label.trim() || 'Untitled item',
      completed: Boolean(item.completed),
      section: typeof item.section === 'string' && item.section.trim() ? item.section.trim() : null,
    }));
  if (items.length > 100) return null;
  const mode = input.mode === 'tournament' ? 'tournament' : 'gameday';
  const shareToken = textValue(input.shareToken);
  return {
    title: textValue(input.title, 'Gameday Checklist').trim() || 'Gameday Checklist',
    mode,
    items,
    ...(shareToken ? { shareToken } : {}),
    ...(typeof input.revision === 'number' && Number.isInteger(input.revision) && input.revision > 0
      ? { revision: input.revision }
      : {}),
  };
}

export function readGamedayChecklist(storage: Storage, key = gamedayChecklistStorageKey) {
  try {
    const raw = storage.getItem(key);
    return raw ? normalizeChecklist(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveGamedayChecklist(
  storage: Storage,
  checklist: LocalGamedayChecklist,
  key = gamedayChecklistStorageKey,
) {
  storage.setItem(key, JSON.stringify(checklist));
}

export function resetGamedayChecklist(current: LocalGamedayChecklist): LocalGamedayChecklist {
  return {
    ...current,
    items: gamedayChecklistTemplate.map((item) => ({ ...item })),
  };
}

export function completedChecklistCount(items: readonly GamedayChecklistItem[]) {
  return items.filter((item) => item.completed).length;
}