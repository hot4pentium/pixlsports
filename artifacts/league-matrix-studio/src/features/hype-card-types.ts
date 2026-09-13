export type HypeFormat = 'square' | 'story' | 'landscape' | 'card';
export type TemplateId = 'spotlight' | 'impact' | 'clean';
export type CardLayoutId = 'slugger' | 'all-star' | 'rookie' | 'dugout';
export type PaletteId = 'coral' | 'teal' | 'gold' | 'midnight';

export type HypeCardProject = {
  version: 2;
  headline: string;
  mediaType: 'image' | 'video' | null;
  mediaId: string | null;
  videoMeta: {
    name: string;
    type: string;
    size: number;
    duration: number;
  } | null;
  template: TemplateId;
  layout: CardLayoutId;
  format: HypeFormat;
  palette: PaletteId;
  background: 'solid' | 'gradient' | 'paper';
  overlay: boolean;
  branding: boolean;
  playerName: string;
  jerseyNumber: string;
  teamName: string;
  position: string;
  grade: string;
  stat: string;
  achievement: string;
  coachMessage: string;
  visibility: {
    grade: boolean;
    stat: boolean;
    achievement: boolean;
    coachMessage: boolean;
  };
  photo: string | null;
  logo: string | null;
  photoTransform: {
    zoom: number;
    x: number;
    y: number;
    rotation: number;
    flip: boolean;
  };
  adjustments: {
    brightness: number;
    contrast: number;
    saturation: number;
  };
};

export const HEADLINES = [
  'BIG PLAY',
  'CLUTCH',
  'THUNDER',
  'GAME CHANGER',
  'WALK-OFF',
  'GAME WINNER',
  'BIG SAVE',
  'HOME RUN',
  'TOUCHDOWN',
  'GOOOAL',
  'BUZZER BEATER',
  'ACE',
  'STRIKEOUT',
  'UNSTOPPABLE'
];

export const templates: Array<{ id: TemplateId; name: string; summary: string }> = [
  { id: 'spotlight', name: 'Spotlight', summary: 'Dramatic lights and a player-first frame.' },
  { id: 'impact', name: 'Impact', summary: 'A bold number with motion and team color.' },
  { id: 'clean', name: 'Clean Game Day', summary: 'Modern, clear, and ready for any sport.' },
];

export const cardLayouts: Array<{ id: CardLayoutId; name: string; summary: string; tone: string }> = [
  { id: 'slugger', name: 'Slugger', summary: 'Wave base and bold nameplate.', tone: '#f36f4c' },
  { id: 'all-star', name: 'All-Star', summary: 'Centered portrait with a badge feel.', tone: '#f5c94d' },
  { id: 'rookie', name: 'Rookie', summary: 'Big number, angled crop, hard edge.', tone: '#177d76' },
  { id: 'dugout', name: 'Dugout', summary: 'Clean frame with a scoreboard finish.', tone: '#243248' },
];

export const formats: Array<{ id: HypeFormat; label: string; dimensions: string }> = [
  { id: 'card', label: 'Vertical card', dimensions: '1000 × 1400' },
  { id: 'square', label: 'Square post', dimensions: '1080 × 1080' },
  { id: 'story', label: 'Vertical story', dimensions: '1080 × 1920' },
  { id: 'landscape', label: 'Landscape', dimensions: '1920 × 1080' },
];

export const palettes: Record<PaletteId, { name: string; primary: string; secondary: string; accent: string; ink: string; paper: string }> = {
  coral: { name: 'Home court', primary: '#f36f4c', secondary: '#177d76', accent: '#f5c94d', ink: '#243248', paper: '#f8e8d4' },
  teal: { name: 'Fresh turf', primary: '#177d76', secondary: '#f36f4c', accent: '#f5c94d', ink: '#193d43', paper: '#dcefe9' },
  gold: { name: 'Friday lights', primary: '#f5c94d', secondary: '#f36f4c', accent: '#177d76', ink: '#243248', paper: '#fff4c8' },
  midnight: { name: 'After dark', primary: '#243248', secondary: '#177d76', accent: '#f36f4c', ink: '#f9f3e8', paper: '#35445c' },
};

export const defaultProject = (): HypeCardProject => ({
  version: 2,
  headline: 'BIG PLAY',
  mediaType: null,
  mediaId: null,
  videoMeta: null,
  template: 'spotlight',
  layout: 'slugger',
  format: 'card',
  palette: 'coral',
  background: 'gradient',
  overlay: true,
  branding: true,
  playerName: '',
  jerseyNumber: '12',
  teamName: 'Eastside Falcons',
  position: 'Point guard',
  grade: '8th grade',
  stat: '12 points',
  achievement: 'Player of the week',
  coachMessage: 'Keep showing up.',
  visibility: { grade: true, stat: true, achievement: true, coachMessage: true },
  photo: null,
  logo: null,
  photoTransform: { zoom: 1, x: 0, y: 0, rotation: 0, flip: false },
  adjustments: { brightness: 1, contrast: 1, saturation: 1 },
});

export function getDimensions(format: HypeFormat) {
  if (format === 'story') return { width: 1080, height: 1920 };
  if (format === 'landscape') return { width: 1920, height: 1080 };
  if (format === 'card') return { width: 1000, height: 1400 };
  return { width: 1080, height: 1080 };
}

export function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
