export type HypeFormat = 'square' | 'story' | 'landscape' | 'card';
export type TemplateId = 'spotlight' | 'impact' | 'clean';
export type CardLayoutId = 'slugger' | 'all-star' | 'rookie' | 'dugout';
export type PaletteId = 'coral' | 'teal' | 'gold' | 'midnight';
export type CardFinishId = 'classic' | 'cosmic-clash' | 'gold-spotlight' | 'neon-prism' | 'paint-impact';

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
  trimStart: number;
  trimEnd: number;
  template: TemplateId;
  layout: CardLayoutId;
  format: HypeFormat;
  palette: PaletteId;
  finish: CardFinishId;
  background: 'solid' | 'gradient' | 'paper';
  overlay: boolean;
  branding: boolean;
  playerName: string;
  jerseyNumber: string;
  teamName: string;
  position: string;
  stat: string;
  achievement: string;
  coachMessage: string;
  visibility: {
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
  { id: 'slugger', name: 'Stadium Entrance', summary: 'Cool blue tunnel opening onto the arena.', tone: '#4fb4ff' },
  { id: 'all-star', name: 'Sunset Stadium', summary: 'Open-air stadium under warm evening lights.', tone: '#ff9d52' },
  { id: 'rookie', name: 'Locker Room Walkout', summary: 'Premium dark corridor with warm gold lighting.', tone: '#efb65d' },
  { id: 'dugout', name: 'Split-Light Arena', summary: 'Dark studio with blue and orange edge lights.', tone: '#2f9dff' },
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

export const cardFinishes: Array<{ id: CardFinishId; name: string; summary: string; preview: string }> = [
  { id: 'classic', name: 'Classic', summary: 'The original premium team-metal finish.', preview: 'linear-gradient(135deg,#090d14 0 42%,#20e878 43% 48%,#dce3ea 49% 55%,#151c27 56%)' },
  { id: 'cosmic-clash', name: 'Cosmic Clash', summary: 'Electric blue, orange energy, and stadium lights.', preview: 'radial-gradient(circle at 22% 28%,#33a8ff 0 4%,transparent 18%),radial-gradient(circle at 78% 75%,#ff6a00 0 5%,transparent 28%),linear-gradient(135deg,#031330,#064edb 48%,#fa5a00)' },
  { id: 'gold-spotlight', name: 'Gold Spotlight', summary: 'Deep green atmosphere with gold light and particles.', preview: 'radial-gradient(ellipse at 50% 100%,#ffe078 0 3%,transparent 34%),linear-gradient(110deg,transparent 25%,#f8cf66 48%,transparent 61%),#041b14' },
  { id: 'neon-prism', name: 'Neon Prism', summary: 'Magenta and cyan beams with crystalline edges.', preview: 'linear-gradient(155deg,transparent 32%,#ff24df 34% 39%,transparent 41%),linear-gradient(25deg,#060518 25%,#0078d7 50%,#d914c7 78%,#09051d)' },
  { id: 'paint-impact', name: 'Paint Impact', summary: 'Red, blue, white, and gold paint-burst energy.', preview: 'radial-gradient(circle at 15% 20%,#ed2e2e 0 9%,transparent 24%),radial-gradient(circle at 82% 25%,#176fe0 0 12%,transparent 28%),radial-gradient(circle at 22% 85%,#f5b91f 0 8%,transparent 23%),#071421' },
];

export const defaultProject = (): HypeCardProject => ({
  version: 2,
  headline: 'BIG PLAY',
  mediaType: null,
  mediaId: null,
  videoMeta: null,
  trimStart: 0,
  trimEnd: 15,
  template: 'spotlight',
  layout: 'slugger',
  format: 'card',
  palette: 'coral',
  finish: 'classic',
  background: 'gradient',
  overlay: true,
  branding: true,
  playerName: '',
  jerseyNumber: '12',
  teamName: 'Eastside Falcons',
  position: 'Point guard',
  stat: '12 points',
  achievement: 'Player of the week',
  coachMessage: 'Keep showing up.',
  visibility: { stat: true, achievement: true, coachMessage: true },
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
