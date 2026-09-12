import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  FileImage,
  FlipHorizontal2,
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  Lightbulb,
  Move,
  Palette,
  RotateCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type HypeFormat = 'square' | 'story' | 'landscape' | 'card';
type TemplateId = 'spotlight' | 'impact' | 'clean';
type CardLayoutId = 'slugger' | 'all-star' | 'rookie' | 'dugout';
type PaletteId = 'coral' | 'teal' | 'gold' | 'midnight';

type HypeCardProject = {
  version: 1;
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

const STORAGE_KEY = 'leaguematrix-hype-card-project-v2';
const PROJECT_FILE_TYPE = 'application/json';

const templates: Array<{ id: TemplateId; name: string; summary: string }> = [
  { id: 'spotlight', name: 'Spotlight', summary: 'Dramatic lights and a player-first frame.' },
  { id: 'impact', name: 'Impact', summary: 'A bold number with motion and team color.' },
  { id: 'clean', name: 'Clean Game Day', summary: 'Modern, clear, and ready for any sport.' },
];

const cardLayouts: Array<{ id: CardLayoutId; name: string; summary: string; tone: string }> = [
  { id: 'slugger', name: 'Slugger', summary: 'Wave base and bold nameplate.', tone: '#f36f4c' },
  { id: 'all-star', name: 'All-Star', summary: 'Centered portrait with a badge feel.', tone: '#f5c94d' },
  { id: 'rookie', name: 'Rookie', summary: 'Big number, angled crop, hard edge.', tone: '#177d76' },
  { id: 'dugout', name: 'Dugout', summary: 'Clean frame with a scoreboard finish.', tone: '#243248' },
];

const formats: Array<{ id: HypeFormat; label: string; dimensions: string }> = [
  { id: 'card', label: 'Vertical card', dimensions: '1000 × 1400' },
  { id: 'square', label: 'Square post', dimensions: '1080 × 1080' },
  { id: 'story', label: 'Vertical story', dimensions: '1080 × 1920' },
  { id: 'landscape', label: 'Landscape', dimensions: '1920 × 1080' },
];

const palettes: Record<
  PaletteId,
  { name: string; primary: string; secondary: string; accent: string; ink: string; paper: string }
> = {
  coral: {
    name: 'Home court',
    primary: '#f36f4c',
    secondary: '#177d76',
    accent: '#f5c94d',
    ink: '#243248',
    paper: '#f8e8d4',
  },
  teal: {
    name: 'Fresh turf',
    primary: '#177d76',
    secondary: '#f36f4c',
    accent: '#f5c94d',
    ink: '#193d43',
    paper: '#dcefe9',
  },
  gold: {
    name: 'Friday lights',
    primary: '#f5c94d',
    secondary: '#f36f4c',
    accent: '#177d76',
    ink: '#243248',
    paper: '#fff4c8',
  },
  midnight: {
    name: 'After dark',
    primary: '#243248',
    secondary: '#177d76',
    accent: '#f36f4c',
    ink: '#f9f3e8',
    paper: '#35445c',
  },
};

const defaultProject = (): HypeCardProject => ({
  version: 1,
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

function getDimensions(format: HypeFormat) {
  if (format === 'story') return { width: 1080, height: 1920 };
  if (format === 'landscape') return { width: 1920, height: 1080 };
  if (format === 'card') return { width: 1000, height: 1400 };
  return { width: 1080, height: 1080 };
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hype-card';
}

function readProjectFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that project file.'));
    reader.readAsText(file);
  });
}

function isProject(value: unknown): value is { tool: string; project: HypeCardProject } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { tool?: unknown; project?: unknown };
  return candidate.tool === 'hype-card' && Boolean(candidate.project) && typeof candidate.project === 'object';
}

function isSafeRasterDataUrl(url: string | null): boolean {
  if (!url) return false;
  return /^data:image\/(jpeg|png|webp|gif);base64,/.test(url);
}

function normalizeProject(project: HypeCardProject): HypeCardProject {
  const defaults = defaultProject();
  return {
    ...defaults,
    ...project,
    layout: project.layout ?? defaults.layout,
    photoTransform: { ...defaults.photoTransform, ...project.photoTransform },
    adjustments: { ...defaults.adjustments, ...project.adjustments },
    visibility: { ...defaults.visibility, ...project.visibility },
    photo: isSafeRasterDataUrl(project.photo) ? project.photo : null,
    logo: isSafeRasterDataUrl(project.logo) ? project.logo : null,
  };
}

function assetUpload(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (dataUrl: string) => void,
  onError: (message: string) => void,
) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    onError('Please choose an image file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const res = String(reader.result);
    if (!isSafeRasterDataUrl(res)) {
      onError('Please choose a valid PNG, JPG, WEBP, or GIF.');
      return;
    }
    onLoad(res);
  };
  reader.onerror = () => onError('That image could not be loaded. Try another file.');
  reader.readAsDataURL(file);
}

function getPhotoFrame(format: HypeFormat) {
  const { width, height } = getDimensions(format);
  if (format === 'landscape') return { x: 70, y: 90, width: width * 0.48, height: height - 180, radius: 38 };
  if (format === 'story') return { x: 70, y: 135, width: width - 140, height: height * 0.43, radius: 38 };
  if (format === 'card') return { x: 60, y: 95, width: width - 120, height: height * 0.42, radius: 34 };
  return { x: 60, y: 90, width: width - 120, height: height * 0.47, radius: 38 };
}

function fitText(text: string, maxWidth: number, baseSize: number, charWidthRatio = 0.65, letterSpacing = 0) {
  if (!text) return baseSize;
  const len = text.length;
  const estimated = len * baseSize * charWidthRatio + (len > 1 ? (len - 1) * letterSpacing : 0);
  if (estimated <= maxWidth) return baseSize;
  const fitted = (maxWidth - (len > 1 ? (len - 1) * letterSpacing : 0)) / (len * charWidthRatio);
  return Math.floor(Math.max(12, Math.min(baseSize, fitted)));
}

type PaletteValue = { name: string; primary: string; secondary: string; accent: string; ink: string; paper: string };

function getPremiumDefs(palette: PaletteValue, ns: string) {
  const teamPrimary = palette.primary;
  const teamSecondary = palette.secondary;
  const teamAccent = palette.accent;
  
  return `
    <linearGradient id="metalCore-${ns}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="25%" stop-color="#a0a5ad"/>
      <stop offset="50%" stop-color="#d1d6dc"/>
      <stop offset="75%" stop-color="#7a828e"/>
      <stop offset="100%" stop-color="#f1f4f8"/>
    </linearGradient>
    <linearGradient id="chromeText-${ns}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#8892a0"/>
      <stop offset="50%" stop-color="#11151c"/>
      <stop offset="55%" stop-color="#5a6270"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="chromeDark-${ns}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#3a4250"/>
      <stop offset="50%" stop-color="#0a0f18"/>
      <stop offset="55%" stop-color="#1a2230"/>
      <stop offset="100%" stop-color="#4a5260"/>
    </linearGradient>
    <linearGradient id="metalDark-${ns}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2a323e"/>
      <stop offset="50%" stop-color="#11151c"/>
      <stop offset="100%" stop-color="#2a323e"/>
    </linearGradient>
    <linearGradient id="teamMetal-${ns}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${teamPrimary}"/>
      <stop offset="50%" stop-color="${teamSecondary}"/>
      <stop offset="100%" stop-color="${teamPrimary}"/>
    </linearGradient>
    <linearGradient id="teamAccentMetal-${ns}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="${teamAccent}"/>
      <stop offset="100%" stop-color="${teamAccent}"/>
    </linearGradient>
    <linearGradient id="fadeToDark-${ns}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#080c14" stop-opacity="0"/>
      <stop offset="60%" stop-color="#080c14" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#080c14" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="bgGradient-${ns}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${teamSecondary}"/>
      <stop offset="100%" stop-color="#080c14"/>
    </linearGradient>
    <linearGradient id="lightRay-${ns}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="arenaGlow-${ns}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${teamPrimary}" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="${teamPrimary}" stop-opacity="0"/>
    </radialGradient>
    
    <filter id="blur3-${ns}"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="blur6-${ns}"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="blur10-${ns}"><feGaussianBlur stdDeviation="10"/></filter>
    
    <filter id="neonGlow-${ns}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur1" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur2" />
      <feMerge>
        <feMergeNode in="blur2" />
        <feMergeNode in="blur1" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <filter id="neonGlowTeam-${ns}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur1" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="20" result="blur2" />
      <feComponentTransfer in="blur2" result="glow2">
        <feFuncA type="linear" slope="0.6"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode in="glow2" />
        <feMergeNode in="blur1" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    
    <filter id="dropShadow-${ns}" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000" flood-opacity="0.9"/>
    </filter>
    <filter id="dropShadowSmall-${ns}" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.9"/>
    </filter>

    <pattern id="carbonFiber-${ns}" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="#111" />
      <path d="M0 6h6v6H0zm6-6h6v6H6z" fill="#181818" />
      <path d="M0 0h6v6H0zm6 6h6v6H6z" fill="#080808" />
    </pattern>

    <pattern id="stadiumGrid-${ns}" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect width="80" height="80" fill="none" />
      <circle cx="40" cy="40" r="1.5" fill="rgba(255,255,255,0.15)" />
      <path d="M40 0v80M0 40h80" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
    </pattern>
  `;
}

function getFlare(x: number, y: number, scale: number, ns: string, color = 'white') {
  return `<path d="M ${x},${y - 20 * scale} Q ${x},${y} ${x + 20 * scale},${y} Q ${x},${y} ${x},${y + 20 * scale} Q ${x},${y} ${x - 20 * scale},${y} Q ${x},${y} ${x},${y - 20 * scale}" fill="${color}" filter="url(#neonGlow-${ns})"/><circle cx="${x}" cy="${y}" r="${3 * scale}" fill="#ffffff" filter="url(#dropShadowSmall-${ns})"/>`;
}

function getCardBackground(project: HypeCardProject, ns: string) {
  if (project.background === 'solid') {
    return `<rect x="0" y="0" width="1000" height="1400" fill="#080c14" />`;
  }
  if (project.background === 'paper') {
    return `<rect x="0" y="0" width="1000" height="1400" fill="#0c121e" /><rect x="0" y="0" width="1000" height="1400" fill="url(#stadiumGrid-${ns})" opacity="0.6" />`;
  }
  return `<rect x="0" y="0" width="1000" height="1400" fill="url(#bgGradient-${ns})" />`;
}

function getArenaBg(palette: PaletteValue, ns: string) {
  return `
    <rect x="0" y="0" width="1000" height="1400" fill="#080c14" />
    <circle cx="500" cy="500" r="700" fill="url(#arenaGlow-${ns})" opacity="0.45" />
    
    <!-- Crowd bokeh -->
    <g opacity="0.55">
      <circle cx="200" cy="700" r="10" fill="#fff" filter="url(#blur3-${ns})"/>
      <circle cx="250" cy="720" r="15" fill="${palette.accent}" filter="url(#blur6-${ns})"/>
      <circle cx="800" cy="650" r="12" fill="#fff" filter="url(#blur3-${ns})"/>
      <circle cx="750" cy="680" r="8" fill="${palette.primary}" filter="url(#blur3-${ns})"/>
      <circle cx="300" cy="600" r="20" fill="${palette.secondary}" filter="url(#blur6-${ns})"/>
      <circle cx="700" cy="620" r="18" fill="#fff" filter="url(#blur6-${ns})"/>
      <circle cx="100" cy="550" r="14" fill="${palette.accent}" filter="url(#blur6-${ns})"/>
      <circle cx="900" cy="580" r="22" fill="${palette.primary}" filter="url(#blur10-${ns})"/>
      <circle cx="400" cy="650" r="12" fill="#fff" filter="url(#blur3-${ns})"/>
      <circle cx="600" cy="660" r="15" fill="${palette.secondary}" filter="url(#blur6-${ns})"/>
    </g>

    <!-- Stadium Lights -->
    <g filter="url(#neonGlow-${ns})">
      <ellipse cx="120" cy="200" rx="80" ry="25" fill="#ffffff" transform="rotate(25 120 200)" />
      <circle cx="90" cy="180" r="8" fill="${palette.primary}" />
      <circle cx="120" cy="200" r="12" fill="#ffffff" />
      <circle cx="150" cy="220" r="8" fill="${palette.primary}" />
      
      <ellipse cx="880" cy="200" rx="80" ry="25" fill="#ffffff" transform="rotate(-25 880 200)" />
      <circle cx="850" cy="220" r="8" fill="${palette.primary}" />
      <circle cx="880" cy="200" r="12" fill="#ffffff" />
      <circle cx="910" cy="180" r="8" fill="${palette.primary}" />
    </g>
    <polygon points="120,200 400,1000 -100,1000" fill="url(#lightRay-${ns})" opacity="0.25" />
    <polygon points="880,200 1100,1000 600,1000" fill="url(#lightRay-${ns})" opacity="0.25" />

    <!-- Player Silhouette Outline -->
    <path d="M 380 900 C 380 650, 430 500, 500 500 C 570 500, 620 650, 620 900 L 670 1400 L 330 1400 Z" fill="#000" opacity="0.75" filter="url(#dropShadow-${ns})"/>
    <path d="M 380 900 C 380 650, 430 500, 500 500 C 570 500, 620 650, 620 900 L 670 1400 L 330 1400 Z" fill="none" stroke="url(#metalCore-${ns})" stroke-width="3" opacity="0.6" />
    
    <rect x="200" y="600" width="600" height="120" rx="20" fill="#000" opacity="0.6" filter="url(#dropShadow-${ns})" />
    <text x="500" y="665" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="34" font-weight="800" letter-spacing="10" fill="#ffffff">ADD PLAYER PHOTO</text>
  `;
}

function getOuterFrame(palette: PaletteValue, ns: string) {
  return `
    <rect x="15" y="15" width="970" height="1370" rx="45" fill="none" stroke="#000" stroke-width="24" filter="url(#dropShadow-${ns})"/>
    <rect x="25" y="25" width="950" height="1350" rx="35" fill="none" stroke="url(#metalCore-${ns})" stroke-width="16" filter="url(#dropShadow-${ns})"/>
    <rect x="33" y="33" width="934" height="1334" rx="27" fill="none" stroke="#0a0f18" stroke-width="12" />
    
    <rect x="39" y="39" width="922" height="1322" rx="21" fill="none" stroke="${palette.primary}" stroke-width="4" filter="url(#neonGlowTeam-${ns})" />
    <rect x="39" y="39" width="922" height="1322" rx="21" fill="none" stroke="#ffffff" stroke-width="1.5" />
    
    <path d="M 25 120 L 120 25 M 975 120 L 880 25 M 25 1280 L 120 1375 M 975 1280 L 880 1375" stroke="url(#metalCore-${ns})" stroke-width="16" filter="url(#dropShadowSmall-${ns})"/>
    <path d="M 25 120 L 120 25 M 975 120 L 880 25 M 25 1280 L 120 1375 M 975 1280 L 880 1375" stroke="#000" stroke-width="4" stroke-dasharray="8 8" />

    <circle cx="80" cy="80" r="12" fill="url(#chromeDark-${ns})" stroke="url(#metalCore-${ns})" stroke-width="3" filter="url(#dropShadowSmall-${ns})" />
    <circle cx="920" cy="80" r="12" fill="url(#chromeDark-${ns})" stroke="url(#metalCore-${ns})" stroke-width="3" filter="url(#dropShadowSmall-${ns})" />
    <circle cx="80" cy="1320" r="12" fill="url(#chromeDark-${ns})" stroke="url(#metalCore-${ns})" stroke-width="3" filter="url(#dropShadowSmall-${ns})" />
    <circle cx="920" cy="1320" r="12" fill="url(#chromeDark-${ns})" stroke="url(#metalCore-${ns})" stroke-width="3" filter="url(#dropShadowSmall-${ns})" />
  `;
}

function cardContent(project: HypeCardProject) {
  const player = escapeXml((project.playerName || 'YOUR PLAYER').toUpperCase());
  const number = escapeXml(project.jerseyNumber || '00');
  const team = escapeXml((project.teamName || 'YOUR TEAM').toUpperCase());
  const details = escapeXml([project.position, project.visibility.grade ? project.grade : ''].filter(Boolean).join('  •  ') || 'GAME DAY').toUpperCase();
  const recognition = escapeXml([
    project.visibility.achievement ? project.achievement : '',
    project.visibility.stat ? project.stat : '',
  ].filter(Boolean).join('  •  ') || 'MAKE THE MOMENT COUNT').toUpperCase();
  const message = escapeXml(project.visibility.coachMessage ? project.coachMessage : '');
  return { player, number, team, details, recognition, message };
}

function buildSluggerCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  const ns = Math.random().toString(36).substring(2, 9);
  
  const frame = { x: 33, y: 33, width: 934, height: 1334 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 700px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : getArenaBg(palette, ns);

  const logo = project.logo
    ? `<image href="${project.logo}" x="400" y="320" width="200" height="140" preserveAspectRatio="xMidYMid meet" filter="url(#dropShadow-${ns})"/>`
    : '';

  const motion = project.overlay
    ? `<g opacity="0.4" filter="url(#neonGlowTeam-${ns})">
         <path d="M-100 400 L 1100 200" stroke="${palette.accent}" stroke-width="6" />
         <path d="M-100 600 L 1100 400" stroke="${palette.primary}" stroke-width="4" />
         <path d="M-100 800 L 1100 600" stroke="#fff" stroke-width="2" />
       </g>`
    : '';

  const branding = project.branding
    ? `<text x="500" y="1310" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">LEAGUEMATRIX CREATIVE STUDIO</text>`
    : '';

  const coachMessage = content.message ? `<text x="500" y="1285" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 800, 18, 0.65)}" font-weight="700" letter-spacing="3" fill="#fff" opacity="0.8">${content.message}</text>` : '';
  const recY = content.message ? 1255 : 1275;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs>
      <clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath>
      ${getPremiumDefs(palette, ns)}
    </defs>
    
    <rect width="1000" height="1400" rx="45" fill="#000" />
    
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      
      ${photo}
      
      <rect x="30" y="30" width="940" height="1340" fill="url(#fadeToDark-${ns})" opacity="0.5"/>
      <rect x="30" y="700" width="940" height="670" fill="url(#fadeToDark-${ns})" opacity="0.8"/>
      
      ${motion}
      
      <text x="500" y="900" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="700" font-weight="800" letter-spacing="-20" fill="#fff" opacity="0.05">#${content.number}</text>
      
      ${logo}

      <g transform="translate(500, 240)">
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="280" font-weight="800" letter-spacing="-10" fill="#000" stroke="#000" stroke-width="34" transform="translate(0, 16)"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="280" font-weight="800" letter-spacing="-10" fill="none" stroke="${palette.primary}" stroke-width="26" transform="translate(0, 8)" filter="url(#neonGlowTeam-${ns})"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="280" font-weight="800" letter-spacing="-10" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="6" filter="url(#dropShadowSmall-${ns})">HYPE</text>
      </g>

      ${getFlare(200, 100, 3, ns, '#fff')}
      ${getFlare(800, 260, 2.5, ns, palette.accent)}
      
      <!-- Angled base -->
      <path d="M 10 1080 L 990 930 L 990 1400 L 10 1400 Z" fill="#000" filter="url(#dropShadow-${ns})" />
      <path d="M 10 1080 L 990 930 L 990 1400 L 10 1400 Z" fill="url(#chromeDark-${ns})" />
      <path d="M 10 1080 L 990 930 L 990 1400 L 10 1400 Z" fill="url(#carbonFiber-${ns})" opacity="0.9"/>
      
      <!-- Thick Metallic Slash -->
      <path d="M -10 1080 L 1010 930" stroke="#000" stroke-width="28" filter="url(#dropShadow-${ns})" />
      <path d="M -10 1080 L 1010 930" stroke="url(#metalCore-${ns})" stroke-width="18" />
      <path d="M -10 1088 L 1010 938" stroke="${palette.accent}" stroke-width="6" filter="url(#neonGlowTeam-${ns})" />

      <!-- Thick Chrome Nameplate -->
      <rect x="70" y="1010" width="860" height="150" rx="24" fill="#000" stroke="#000" stroke-width="20" filter="url(#dropShadow-${ns})" />
      <rect x="70" y="1010" width="860" height="150" rx="24" fill="url(#teamMetal-${ns})" stroke="url(#metalCore-${ns})" stroke-width="12" />
      <rect x="78" y="1018" width="844" height="134" rx="16" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="3" />
      
      <text x="500" y="1115" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.player, 800, 100, 0.75, 2)}" font-weight="800" letter-spacing="2" fill="#000" stroke="#000" stroke-width="14" transform="translate(0,8)"></text>
      <text x="500" y="1115" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.player, 800, 100, 0.75, 2)}" font-weight="800" letter-spacing="2" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="3" filter="url(#dropShadowSmall-${ns})">${content.player}</text>
      
      <text x="500" y="1195" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.team + ' • #' + content.number, 800, 26, 0.65, 4)}" font-weight="800" letter-spacing="4" fill="${palette.accent}" filter="url(#neonGlow-${ns})">${content.team}  •  #${content.number}</text>
      <text x="500" y="1225" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.details, 800, 22, 0.65, 4)}" font-weight="800" letter-spacing="4" fill="#ffffff" opacity="0.9">${content.details}</text>
      <text x="500" y="${recY}" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.recognition, 800, 30, 0.75)}" font-weight="800" fill="#fff">${content.recognition}</text>
      
      ${coachMessage}
      ${branding}
    </g>
    
    ${getOuterFrame(palette, ns)}
  </svg>`;
}

function buildAllStarCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  const ns = Math.random().toString(36).substring(2, 9);
  
  const frame = { x: 150, y: 300, width: 700, height: 700 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 650px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : `<g transform="translate(0, 150)">${getArenaBg(palette, ns)}</g>`;

  const logo = project.logo
    ? `<image href="${project.logo}" x="400" y="860" width="200" height="140" preserveAspectRatio="xMidYMid meet" filter="url(#dropShadow-${ns})"/>`
    : `<circle cx="500" cy="930" r="70" fill="url(#teamMetal-${ns})" stroke="url(#metalCore-${ns})" stroke-width="8" filter="url(#dropShadow-${ns})"/><text x="500" y="955" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="70" font-weight="800" fill="#fff">#${content.number}</text>`;

  const motion = project.overlay
    ? `<g opacity="0.5" filter="url(#neonGlowTeam-${ns})">
         <circle cx="500" cy="700" r="450" fill="none" stroke="${palette.primary}" stroke-width="4" stroke-dasharray="20 40" />
         <circle cx="500" cy="700" r="480" fill="none" stroke="${palette.accent}" stroke-width="2" />
       </g>`
    : '';

  const branding = project.branding
    ? `<text x="500" y="1320" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">LEAGUEMATRIX CREATIVE STUDIO</text>`
    : '';
    
  const coachMessage = content.message ? `<text x="500" y="1295" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 600, 18, 0.65, 3)}" font-weight="700" letter-spacing="3" fill="#fff" opacity="0.8">${content.message}</text>` : '';
  const recY = content.message ? 1242 : 1262;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs>
      <clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath>
      <clipPath id="shieldClip-${ns}">
        <path d="M 500 250 C 740 250, 880 430, 880 720 C 880 970, 500 1150, 500 1150 C 500 1150, 120 970, 120 720 C 120 430, 260 250, 500 250 Z" />
      </clipPath>
      ${getPremiumDefs(palette, ns)}
    </defs>
    
    <rect width="1000" height="1400" rx="45" fill="#000" />
    
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      
      <circle cx="500" cy="700" r="450" fill="${palette.primary}" opacity="0.65" filter="url(#blur10-${ns})" />
      
      ${motion}
      
      <g transform="translate(500, 180)">
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="180" font-weight="800" letter-spacing="4" fill="#000" stroke="#000" stroke-width="28" transform="translate(0, 14)"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="180" font-weight="800" letter-spacing="4" fill="none" stroke="${palette.accent}" stroke-width="22" transform="translate(0, 7)" filter="url(#neonGlowTeam-${ns})"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="180" font-weight="800" letter-spacing="4" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="5" filter="url(#dropShadowSmall-${ns})">ALL STAR</text>
      </g>

      <path d="M 500 230 C 760 230, 900 420, 900 720 C 900 990, 500 1180, 500 1180 C 500 1180, 100 990, 100 720 C 100 420, 240 230, 500 230 Z" fill="#000" filter="url(#dropShadow-${ns})" />
      <path d="M 500 230 C 760 230, 900 420, 900 720 C 900 990, 500 1180, 500 1180 C 500 1180, 100 990, 100 720 C 100 420, 240 230, 500 230 Z" fill="url(#teamMetal-${ns})" />
      <path d="M 500 250 C 740 250, 880 430, 880 720 C 880 970, 500 1150, 500 1150 C 500 1150, 120 970, 120 720 C 120 430, 260 250, 500 250 Z" fill="#000" />
      
      <g clip-path="url(#shieldClip-${ns})">
        ${photo}
        <rect x="120" y="250" width="760" height="900" fill="url(#fadeToDark-${ns})" />
      </g>
      
      <path d="M 500 250 C 740 250, 880 430, 880 720 C 880 970, 500 1150, 500 1150 C 500 1150, 120 970, 120 720 C 120 430, 260 250, 500 250 Z" fill="none" stroke="url(#metalCore-${ns})" stroke-width="14" filter="url(#dropShadowSmall-${ns})" />
      <path d="M 500 256 C 734 256, 874 433, 874 720 C 874 964, 500 1144, 500 1144 C 500 1144, 126 964, 126 720 C 126 433, 266 256, 500 256 Z" fill="none" stroke="${palette.accent}" stroke-width="5" filter="url(#neonGlowTeam-${ns})" />
      
      ${logo}
      
      ${getFlare(150, 450, 2.5, ns, '#fff')}
      ${getFlare(850, 450, 2.5, ns, '#fff')}

      <rect x="150" y="1030" width="700" height="150" rx="30" fill="#000" stroke="#000" stroke-width="20" filter="url(#dropShadow-${ns})" />
      <rect x="150" y="1030" width="700" height="150" rx="30" fill="url(#chromeDark-${ns})" stroke="url(#metalCore-${ns})" stroke-width="12" />
      <rect x="158" y="1038" width="684" height="134" rx="22" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3" />
      
      <text x="500" y="1120" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.player, 620, 80, 0.75)}" font-weight="800" fill="#fff" stroke="#000" stroke-width="10" transform="translate(0,6)"></text>
      <text x="500" y="1120" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.player, 620, 80, 0.75)}" font-weight="800" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="2" filter="url(#dropShadowSmall-${ns})">${content.player}</text>
      
      <text x="500" y="1165" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.team + ' • ' + content.details, 640, 22, 0.65, 4)}" font-weight="800" letter-spacing="4" fill="${palette.accent}">${content.team}  •  ${content.details}</text>
      
      <path d="M 250 1200 L 750 1200 L 720 1260 L 280 1260 Z" fill="#000" stroke="#000" stroke-width="12" filter="url(#dropShadowSmall-${ns})" />
      <path d="M 250 1200 L 750 1200 L 720 1260 L 280 1260 Z" fill="url(#teamMetal-${ns})" stroke="url(#metalCore-${ns})" stroke-width="6" />
      <text x="500" y="${recY}" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.recognition, 420, 30, 0.75)}" font-weight="800" fill="#fff">${content.recognition}</text>
      
      ${coachMessage}
      ${branding}
    </g>
    
    ${getOuterFrame(palette, ns)}
  </svg>`;
}

function buildRookieCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  const ns = Math.random().toString(36).substring(2, 9);
  
  const frame = { x: 33, y: 33, width: 934, height: 1334 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 500px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : getArenaBg(palette, ns);

  const logo = project.logo
    ? `<image href="${project.logo}" x="760" y="60" width="160" height="110" preserveAspectRatio="xMidYMid meet" filter="url(#dropShadow-${ns})"/>`
    : '';

  const motion = project.overlay
    ? `<g opacity="0.85">
         <path d="M -100 200 L 1100 900" stroke="${palette.accent}" stroke-width="10" filter="url(#neonGlowTeam-${ns})"/>
         <path d="M -100 260 L 1100 960" stroke="#fff" stroke-width="4" filter="url(#neonGlowTeam-${ns})"/>
         <path d="M -100 320 L 1100 1020" stroke="${palette.primary}" stroke-width="8" filter="url(#neonGlowTeam-${ns})"/>
       </g>`
    : '';

  const branding = project.branding
    ? `<text x="940" y="1335" text-anchor="end" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">LEAGUEMATRIX</text>`
    : '';

  const coachMessage = content.message ? `<text x="70" y="1335" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 600, 18, 0.65, 2)}" font-weight="700" letter-spacing="2" fill="#fff" opacity="0.7">${content.message}</text>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs>
      <clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath>
      <clipPath id="rookiePhoto-${ns}">
        <path d="M 30 30 L 970 30 L 970 850 L 30 1100 Z" />
      </clipPath>
      ${getPremiumDefs(palette, ns)}
    </defs>
    
    <rect width="1000" height="1400" rx="45" fill="#000" />
    
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      
      <text x="60" y="1050" font-family="Space Grotesk,sans-serif" font-size="550" font-weight="800" letter-spacing="-30" fill="url(#teamMetal-${ns})" opacity="0.4" filter="url(#dropShadow-${ns})">#${content.number}</text>
      
      <g clip-path="url(#rookiePhoto-${ns})">
        ${photo}
        <rect x="30" y="550" width="940" height="550" fill="url(#fadeToDark-${ns})" opacity="0.8"/>
      </g>
      
      ${motion}
      
      <path d="M -10 1110 L 1010 840" stroke="#000" stroke-width="34" filter="url(#dropShadow-${ns})" />
      <path d="M -10 1110 L 1010 840" stroke="url(#metalCore-${ns})" stroke-width="24" />
      <path d="M -10 1118 L 1010 848" stroke="${palette.accent}" stroke-width="8" filter="url(#neonGlowTeam-${ns})" />
      
      <g transform="translate(110, 420) rotate(-90)">
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="140" font-weight="800" letter-spacing="16" fill="#000" stroke="#000" stroke-width="20" transform="translate(0,10)"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="140" font-weight="800" letter-spacing="16" fill="none" stroke="${palette.accent}" stroke-width="16" transform="translate(0,5)" filter="url(#neonGlowTeam-${ns})"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="140" font-weight="800" letter-spacing="16" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="4" filter="url(#dropShadowSmall-${ns})">ROOKIE</text>
      </g>
      
      ${logo}
      
      <g transform="translate(70, 1140)">
        <text x="0" y="0" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.player, 860, 120, 0.75, -2)}" font-weight="800" letter-spacing="-2" fill="#000" stroke="#000" stroke-width="16" transform="translate(0,8)"></text>
        <text x="0" y="0" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.player, 860, 120, 0.75, -2)}" font-weight="800" letter-spacing="-2" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="3" filter="url(#dropShadowSmall-${ns})">${content.player}</text>
        
        <text x="5" y="50" font-family="DM Sans,sans-serif" font-size="${fitText(content.team + ' • ' + content.details, 800, 26, 0.65, 4)}" font-weight="800" letter-spacing="4" fill="${palette.accent}" filter="url(#neonGlow-${ns})">${content.team}  •  ${content.details}</text>
        
        <rect x="0" y="70" width="860" height="110" rx="20" fill="#000" stroke="#000" stroke-width="16" filter="url(#dropShadow-${ns})" />
        <rect x="0" y="70" width="860" height="110" rx="20" fill="url(#teamMetal-${ns})" stroke="url(#metalCore-${ns})" stroke-width="8" />
        <text x="30" y="110" font-family="DM Sans,sans-serif" font-size="18" font-weight="800" letter-spacing="4" fill="#fff" opacity="0.9">SEASON HIGHLIGHT</text>
        <text x="30" y="150" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.recognition, 800, 42, 0.75)}" font-weight="800" fill="#fff" filter="url(#dropShadowSmall-${ns})">${content.recognition}</text>
      </g>
      
      ${coachMessage}
      ${branding}
    </g>
    
    ${getOuterFrame(palette, ns)}
  </svg>`;
}

function buildDugoutCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  const ns = Math.random().toString(36).substring(2, 9);
  
  const frame = { x: 70, y: 240, width: 860, height: 660 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 560px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : `<g transform="translate(0, 60)">${getArenaBg(palette, ns)}</g>`;

  const logo = project.logo
    ? `<image href="${project.logo}" x="70" y="75" width="140" height="90" preserveAspectRatio="xMidYMid meet" filter="url(#dropShadow-${ns})"/>`
    : '';

  const motion = project.overlay
    ? `<g opacity="0.4" filter="url(#neonGlowTeam-${ns})">
         <path d="M 0 180 L 1000 180" stroke="${palette.accent}" stroke-width="4" stroke-dasharray="10 20" />
         <path d="M 0 920 L 1000 920" stroke="${palette.accent}" stroke-width="4" stroke-dasharray="10 20" />
       </g>`
    : '';

  const branding = project.branding
    ? `<text x="500" y="1330" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">LEAGUEMATRIX CREATIVE STUDIO</text>`
    : '';

  const coachMessage = content.message ? `<text x="930" y="1255" text-anchor="end" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 400, 18, 0.65, 2)}" font-weight="700" letter-spacing="2" fill="#fff" opacity="0.7">${content.message}</text>` : '';
  const recWidth = content.message ? 380 : 800;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs>
      <clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath>
      <clipPath id="dugoutPhoto-${ns}"><rect x="70" y="240" width="860" height="660" rx="25" /></clipPath>
      ${getPremiumDefs(palette, ns)}
    </defs>
    
    <rect width="1000" height="1400" rx="45" fill="#000" />
    
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      
      <!-- Top Block -->
      <path d="M 30 30 L 970 30 L 970 200 L 780 200 L 720 120 L 30 120 Z" fill="url(#teamMetal-${ns})" />
      ${logo}
      <text x="940" y="90" text-anchor="end" font-family="Space Grotesk,sans-serif" font-size="46" font-weight="800" letter-spacing="4" fill="#fff" filter="url(#dropShadowSmall-${ns})">#${content.number}</text>
      
      <!-- GAME DAY Badge -->
      <g transform="translate(500, 160)">
        <rect x="-260" y="-65" width="520" height="130" fill="#000" rx="25" stroke="#000" stroke-width="20" filter="url(#dropShadow-${ns})"/>
        <rect x="-260" y="-65" width="520" height="130" fill="url(#chromeDark-${ns})" stroke="url(#metalCore-${ns})" stroke-width="10" rx="25" />
        <rect x="-252" y="-57" width="504" height="114" fill="url(#carbonFiber-${ns})" rx="19" />
        <text x="0" y="22" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="82" font-weight="800" letter-spacing="8" fill="none" stroke="${palette.accent}" stroke-width="12" filter="url(#neonGlowTeam-${ns})">GAME DAY</text>
        <text x="0" y="22" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="82" font-weight="800" letter-spacing="8" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="2">GAME DAY</text>
      </g>

      <path d="M 720 120 L 970 120" stroke="${palette.accent}" stroke-width="8" filter="url(#neonGlowTeam-${ns})" />
      
      ${motion}
      
      <rect x="50" y="220" width="900" height="700" rx="35" fill="#0a0a0a" stroke="url(#metalCore-${ns})" stroke-width="16" filter="url(#dropShadow-${ns})" />
      <g clip-path="url(#dugoutPhoto-${ns})">
        ${photo}
        <rect x="70" y="650" width="860" height="250" fill="url(#fadeToDark-${ns})" />
      </g>
      <rect x="70" y="240" width="860" height="660" rx="25" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="6" />
      
      <rect x="70" y="940" width="860" height="350" rx="25" fill="#000" stroke="#000" stroke-width="20" filter="url(#dropShadow-${ns})" />
      <rect x="70" y="940" width="860" height="350" rx="25" fill="#080c14" stroke="url(#metalCore-${ns})" stroke-width="14" />
      <rect x="70" y="940" width="860" height="350" rx="25" fill="url(#stadiumGrid-${ns})" opacity="0.7" />
      <rect x="78" y="948" width="844" height="334" rx="19" fill="none" stroke="rgba(0,0,0,0.8)" stroke-width="8" />
      
      <text x="110" y="1010" font-family="DM Sans,sans-serif" font-size="20" font-weight="800" letter-spacing="8" fill="${palette.accent}" filter="url(#neonGlowTeam-${ns})">PLAYER SPOTLIGHT // DATA</text>
      
      <text x="110" y="1110" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.player, 780, 110, 0.75, 1)}" font-weight="800" letter-spacing="1" fill="#fff" filter="url(#dropShadowSmall-${ns})">${content.player}</text>
      
      <text x="110" y="1165" font-family="DM Sans,sans-serif" font-size="${fitText(content.team + ' • ' + content.details, 780, 26, 0.65, 4)}" font-weight="800" letter-spacing="4" fill="rgba(255,255,255,0.8)">${content.team}  •  ${content.details}</text>
      
      <path d="M 110 1200 L 890 1200" stroke="rgba(255,255,255,0.15)" stroke-width="6" stroke-dasharray="8 8" />
      
      <text x="110" y="1255" font-family="Space Grotesk,sans-serif" font-size="${fitText(content.recognition, recWidth, 36, 0.75)}" font-weight="800" fill="${palette.accent}" filter="url(#neonGlowTeam-${ns})">${content.recognition}</text>
      
      ${coachMessage}
      ${branding}
    </g>
    
    ${getOuterFrame(palette, ns)}
  </svg>`;
}

function buildHypeCardSvg(project: HypeCardProject) {
  if (project.format === 'card') {
    if (project.layout === 'all-star') return buildAllStarCardSvg(project);
    if (project.layout === 'rookie') return buildRookieCardSvg(project);
    if (project.layout === 'dugout') return buildDugoutCardSvg(project);
    return buildSluggerCardSvg(project);
  }
  const { width, height } = getDimensions(project.format);
  const palette = palettes[project.palette];
  const frame = getPhotoFrame(project.format);
  const isLandscape = project.format === 'landscape';
  const isStory = project.format === 'story';
  const template = templates.find((item) => item.id === project.template) ?? templates[0];
  const photo = project.photo
    ? `<image href="${project.photo}" x="${frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x}" y="${frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y}" width="${frame.width * project.photoTransform.zoom}" height="${frame.height * project.photoTransform.zoom}" preserveAspectRatio="xMidYMid slice" style="filter: brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation}); transform-origin: ${frame.x + frame.width / 2}px ${frame.y + frame.height / 2}px; transform: rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})" />`
    : `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="${palette.ink}" opacity=".16"/><circle cx="${frame.x + frame.width / 2}" cy="${frame.y + frame.height * .42}" r="${Math.min(frame.width, frame.height) * .12}" fill="${palette.paper}" opacity=".7"/><path d="M ${frame.x + frame.width * .26} ${frame.y + frame.height * .88} Q ${frame.x + frame.width / 2} ${frame.y + frame.height * .52} ${frame.x + frame.width * .74} ${frame.y + frame.height * .88}" fill="${palette.paper}" opacity=".7"/><text x="${frame.x + frame.width / 2}" y="${frame.y + frame.height * .96}" text-anchor="middle" font-size="${Math.max(18, width * .018)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${palette.paper}" opacity=".9">ADD PLAYER PHOTO</text>`;
  const logo = project.logo
    ? `<image href="${project.logo}" x="${width - (isLandscape ? 190 : 150)}" y="${isStory ? 150 : 65}" width="${isLandscape ? 110 : 90}" height="${isLandscape ? 110 : 90}" preserveAspectRatio="xMidYMid meet" />`
    : '';
  const background = project.background === 'solid'
    ? `<rect width="${width}" height="${height}" fill="${palette.ink}"/>`
    : project.background === 'paper'
      ? `<rect width="${width}" height="${height}" fill="${palette.paper}"/><path d="M0 ${height * .72} Q ${width * .28} ${height * .61} ${width * .56} ${height * .77} T ${width} ${height * .65} V ${height} H0Z" fill="${palette.primary}" opacity=".18"/>`
      : `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${palette.ink}"/><stop offset="100%" stop-color="${palette.primary}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#bg)"/>`;
  const headlineSize = isLandscape ? width * .085 : isStory ? width * .12 : width * .13;
  const textX = isLandscape ? width * .57 : width * .09;
  const textY = isLandscape ? height * .35 : isStory ? height * .59 : height * .62;
  const playerLine = [project.position, project.visibility.grade ? project.grade : ''].filter(Boolean).join(' · ');
  const achievementLine = [
    project.visibility.achievement ? project.achievement : '',
    project.visibility.stat ? project.stat : '',
  ].filter(Boolean).join('  •  ');
  const headline = escapeXml(project.playerName || 'YOUR PLAYER');
  const jersey = escapeXml(project.jerseyNumber || '00');
  const team = escapeXml(project.teamName || 'YOUR TEAM');
  const position = escapeXml(playerLine || 'GAME DAY');
  const achievement = escapeXml(achievementLine || 'MAKE THE MOMENT COUNT');
  const message = escapeXml(project.visibility.coachMessage ? project.coachMessage : '');
  const accentText = palette.primary === palette.ink ? palette.paper : palette.ink;
  const geometric = project.template === 'impact'
    ? `<path d="M0 ${height * .1} L${width * .18} 0 L${width * .28} 0 L${width * .1} ${height * .3}Z" fill="${palette.accent}" opacity=".92"/><path d="M${width * .76} ${height} L${width} ${height * .68} L${width} ${height * .83} L${width * .88} ${height}Z" fill="${palette.secondary}" opacity=".8"/>`
    : project.template === 'clean'
      ? `<path d="M${width * .73} 0 H${width} V${height * .24} Q${width * .86} ${height * .14} ${width * .73} 0Z" fill="${palette.accent}" opacity=".75"/><circle cx="${width * .88}" cy="${height * .78}" r="${width * .13}" fill="none" stroke="${palette.secondary}" stroke-width="${Math.max(12, width * .018)}" opacity=".5"/>`
      : `<circle cx="${width * .92}" cy="${height * .12}" r="${width * .16}" fill="none" stroke="${palette.accent}" stroke-width="${Math.max(16, width * .025)}" opacity=".65"/><circle cx="${width * .05}" cy="${height * .92}" r="${width * .19}" fill="${palette.secondary}" opacity=".52"/>`;
  const overlay = project.overlay
    ? `<path d="M0 ${height * .28} L${width} ${height * .05} M0 ${height * .34} L${width} ${height * .11} M0 ${height * .4} L${width} ${height * .17}" stroke="${palette.paper}" stroke-width="${Math.max(2, width * .004)}" opacity=".12"/>`
    : '';
  const textColor = project.background === 'paper' ? palette.ink : palette.paper;
  const secondaryText = project.background === 'paper' ? palette.ink : palette.paper;
  const photoClip = `<clipPath id="photoClip"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}"/></clipPath>`;
  const photoMarkup = `<g clip-path="url(#photoClip)">${photo}</g><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="none" stroke="${palette.paper}" stroke-opacity=".32" stroke-width="${Math.max(2, width * .004)}"/>`;
  const topLabel = project.template === 'spotlight' ? 'PLAYER SPOTLIGHT' : project.template === 'impact' ? 'MAKE AN IMPACT' : 'GAME DAY';
  const textMarkup = `<text x="${textX}" y="${textY - headlineSize * .82}" font-size="${Math.max(16, width * .018)}" letter-spacing="${Math.max(2, width * .008)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".8">${topLabel}</text><text x="${textX}" y="${textY}" font-size="${headlineSize}" font-family="Space Grotesk, sans-serif" font-weight="700" letter-spacing="${-headlineSize * .06}" fill="${textColor}">${headline}</text><text x="${textX}" y="${textY + headlineSize * .34}" font-size="${Math.max(22, width * .032)}" font-family="Space Grotesk, sans-serif" font-weight="700" fill="${palette.accent}">#${jersey}</text><text x="${textX + Math.max(72, width * .075)}" y="${textY + headlineSize * .34}" font-size="${Math.max(18, width * .022)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".9">${team}</text><text x="${textX}" y="${textY + headlineSize * .65}" font-size="${Math.max(16, width * .018)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".72">${position}</text><text x="${textX}" y="${height - (isLandscape ? 100 : 115)}" font-size="${Math.max(16, width * .018)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".82">${achievement}</text><text x="${textX}" y="${height - (isLandscape ? 64 : 72)}" font-size="${Math.max(15, width * .016)}" font-family="DM Sans, sans-serif" font-weight="500" fill="${secondaryText}" opacity=".62">${message}</text>`;
  const branding = project.branding
    ? `<text x="${width - 55}" y="${height - 36}" text-anchor="end" font-size="${Math.max(12, width * .012)}" letter-spacing="${Math.max(1, width * .004)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".55">LEAGUEMATRIX CREATIVE STUDIO</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${photoClip}</defs>${background}${geometric}${overlay}${photoMarkup}${textMarkup}${logo}${branding}<rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="34" fill="none" stroke="${palette.paper}" stroke-opacity=".18" stroke-width="${Math.max(2, width * .003)}"/><text x="${isLandscape ? width * .57 : width * .09}" y="${isLandscape ? 76 : 64}" font-size="${Math.max(15, width * .014)}" letter-spacing="${Math.max(2, width * .007)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".7">${escapeXml(template.name.toUpperCase())}</text></svg>`;
}

function PreviewCanvas({ project }: { project: HypeCardProject }) {
  const svg = useMemo(() => buildHypeCardSvg(project), [project]);
  const dimensions = getDimensions(project.format);
  return (
    <div className="paper-grid flex min-h-[450px] items-center justify-center overflow-hidden rounded-[24px] border border-border bg-[#e8dfd0] p-4 sm:min-h-[650px] sm:p-8">
      <div
        className="hype-svg-preview max-h-[76vh] w-full max-w-[760px] overflow-hidden rounded-[18px] shadow-[14px_18px_0_rgba(36,50,72,.14)]"
        style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}
        data-testid="hype-preview-canvas"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

function MobilePreviewDialog({
  project,
  open,
  onOpenChange,
  title,
}: {
  project: HypeCardProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  const svg = useMemo(() => buildHypeCardSvg(project), [project]);
  const dimensions = getDimensions(project.format);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
      <button type="button" className="absolute inset-0 bg-[#101827]/85" onClick={() => onOpenChange(false)} aria-label="Close card preview" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-preview-title"
        aria-describedby="mobile-preview-description"
        className="relative z-10 max-h-[96dvh] w-full max-w-xl overflow-y-auto rounded-[26px] border border-border bg-[#e8dfd0] p-4 shadow-2xl sm:p-6"
      >
        <button ref={closeButtonRef} type="button" onClick={() => onOpenChange(false)} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm" aria-label="Close card preview">
          <X className="h-4 w-4" />
        </button>
        <div className="pr-12 text-left">
          <h2 id="mobile-preview-title" className="font-display text-xl font-bold">Your live card</h2>
          <p id="mobile-preview-description" className="mt-1 text-sm text-muted-foreground">{title} · {dimensions.width} × {dimensions.height}. This preview updates as you edit.</p>
        </div>
        <div className="paper-grid flex min-h-0 items-center justify-center rounded-[20px] border border-border p-3">
          <div
            className="hype-svg-preview w-full overflow-hidden rounded-[16px] shadow-[10px_12px_0_rgba(36,50,72,.14)]"
            style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}
            data-testid="mobile-hype-preview-canvas"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        <Button type="button" onClick={() => onOpenChange(false)} className="w-full rounded-full">
          Back to editing
        </Button>
      </section>
    </div>
  );
}

function LayoutOption({
  layout,
  project,
  selected,
  onSelect,
}: {
  layout: (typeof cardLayouts)[number];
  project: HypeCardProject;
  selected: boolean;
  onSelect: () => void;
}) {
  const svg = useMemo(() => buildHypeCardSvg({ ...project, format: 'card', layout: layout.id }), [layout.id, project]);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group overflow-hidden rounded-2xl border p-2 text-left transition-all ${selected ? 'border-primary bg-[#fff0e9] ring-2 ring-primary/40' : 'border-border bg-background hover:border-primary/60'}`}
      aria-pressed={selected}
      data-testid={`button-card-layout-${layout.id}`}
    >
      <div className="relative aspect-[5/7] overflow-hidden rounded-xl bg-[#ddd3c4]">
        <div className="hype-svg-preview absolute inset-0" dangerouslySetInnerHTML={{ __html: svg }} />
        {selected && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-md"><Check className="h-3.5 w-3.5" /></span>}
      </div>
      <span className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold">{layout.name}</span>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: layout.tone }} />
      </span>
      <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">{layout.summary}</span>
    </button>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Palette;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-secondary" />
        <h2 className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function HypeField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
        {label}
        {required && <span className="text-primary">*</span>}
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-xl bg-background"
      />
    </label>
  );
}

function AssetButton({
  label,
  hasAsset,
  onChange,
  onRemove,
}: {
  label: string;
  hasAsset: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 text-xs font-bold transition-colors hover:border-primary hover:bg-[#fff0e9]">
        {hasAsset ? <Check className="h-4 w-4 text-secondary" /> : <Upload className="h-4 w-4 text-muted-foreground" />}
        {hasAsset ? `${label} added` : `Add ${label}`}
        <input type="file" accept="image/*" className="sr-only" onChange={onChange} />
      </label>
      {hasAsset && (
        <button type="button" onClick={onRemove} className="grid h-10 w-10 place-items-center rounded-xl border border-border text-muted-foreground hover:bg-muted" aria-label={`Remove ${label}`}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function HypeCardEditor() {
  const [project, setProject] = useState<HypeCardProject>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return defaultProject();
      const parsed = JSON.parse(stored) as { tool?: string; project?: HypeCardProject };
      return parsed.tool === 'hype-card' && parsed.project ? normalizeProject(parsed.project) : defaultProject();
    } catch {
      return defaultProject();
    }
  });
  const [notice, setNotice] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [validation, setValidation] = useState('');

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tool: 'hype-card', project }));
      window.localStorage.setItem('leaguematrix-project', 'true');
    } catch {
      setNotice('Your browser could not autosave this project. You can still download a project file.');
    }
  }, [project]);

  const updateProject = <K extends keyof HypeCardProject>(key: K, value: HypeCardProject[K]) => {
    setProject((current) => ({ ...current, [key]: value }));
    setValidation('');
  };

  const updateTransform = (key: keyof HypeCardProject['photoTransform'], value: number | boolean) => {
    setProject((current) => ({ ...current, photoTransform: { ...current.photoTransform, [key]: value } }));
  };

  const updateAdjustment = (key: keyof HypeCardProject['adjustments'], value: number) => {
    setProject((current) => ({ ...current, adjustments: { ...current.adjustments, [key]: value } }));
  };

  const updateVisibility = (key: keyof HypeCardProject['visibility'], value: boolean) => {
    setProject((current) => ({ ...current, visibility: { ...current.visibility, [key]: value } }));
  };

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  };

  const resetProject = () => {
    if (!window.confirm('Reset this Hype Card? Your current edits will be removed from this device.')) return;
    setProject(defaultProject());
    setValidation('');
    flash('Project reset');
  };

  const saveProjectFile = () => {
    const payload = {
      app: 'LeagueMatrix Creative Studio',
      tool: 'hype-card',
      version: 1,
      savedAt: new Date().toISOString(),
      project,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: PROJECT_FILE_TYPE });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(project.playerName || project.teamName)}-hype-card.lmx`;
    anchor.click();
    URL.revokeObjectURL(url);
    flash('Editable project downloaded');
  };

  const openProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await readProjectFile(file)) as unknown;
      if (!isProject(parsed) || parsed.project.version !== 1) {
        flash('That is not a supported LeagueMatrix project file.');
        return;
      }
      setProject(normalizeProject(parsed.project));
      setValidation('');
      flash('Project opened on this device');
    } catch {
      flash('That project file could not be opened.');
    }
  };

  const exportImage = async (type: 'png' | 'jpeg') => {
    if (!project.playerName.trim()) {
      setValidation('Add the player name before exporting your card.');
      return;
    }
    setExporting(true);
    setNotice('');
    try {
      const { width, height } = getDimensions(project.format);
      const svg = buildHypeCardSvg(project);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(url);
          setNotice('Image export is not available in this browser.');
          setExporting(false);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((output) => {
          URL.revokeObjectURL(url);
          if (!output) {
            setNotice('The export could not be created. Try again.');
            setExporting(false);
            return;
          }
          const downloadUrl = URL.createObjectURL(output);
          const anchor = document.createElement('a');
          anchor.href = downloadUrl;
          anchor.download = `${slugify(project.playerName)}-${project.format}.${type}`;
          anchor.click();
          URL.revokeObjectURL(downloadUrl);
          setExporting(false);
          flash(`${type === 'png' ? 'PNG' : 'JPEG'} downloaded`);
        }, type === 'png' ? 'image/png' : 'image/jpeg', type === 'png' ? undefined : 0.92);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        setExporting(false);
        setNotice('The preview could not be prepared for export.');
      };
      image.src = url;
    } catch {
      setExporting(false);
      setNotice('The export could not be created. Try again.');
    }
  };

  const template = templates.find((item) => item.id === project.template) ?? templates[0];
  const activeLayout = cardLayouts.find((item) => item.id === project.layout) ?? cardLayouts[0];
  const photoUpload = (event: ChangeEvent<HTMLInputElement>) =>
    assetUpload(
      event,
      (dataUrl) => updateProject('photo', dataUrl),
      (message) => flash(message),
    );
  const logoUpload = (event: ChangeEvent<HTMLInputElement>) =>
    assetUpload(
      event,
      (dataUrl) => updateProject('logo', dataUrl),
      (message) => flash(message),
    );

  return (
    <div className="noise min-h-dvh bg-background">
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-8 lg:px-12">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/studio" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground" aria-label="Back to studio">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-secondary">
                <Sparkles className="h-3.5 w-3.5" /> Hype-Card Creator
              </div>
              <p className="mt-1 hidden truncate text-sm text-muted-foreground sm:block">Make the moment bigger.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {notice && <span className="hidden items-center gap-1.5 text-xs font-semibold text-secondary sm:flex" role="status"><Check className="h-3.5 w-3.5" /> {notice}</span>}
            <button
              type="button"
              onClick={() => setMobilePreviewOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-[#243248] px-2.5 text-xs font-bold text-[#f9f3e8] shadow-sm lg:hidden"
              aria-label={`Open full preview of ${project.format === 'card' ? activeLayout.name : template.name} card`}
              data-testid="button-open-mobile-preview"
            >
              <Eye className="h-4 w-4 text-[#f5c94d]" /> <span className="hidden min-[360px]:inline">Preview</span>
            </button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-bold transition-colors hover:bg-muted">
              <FolderOpen className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Open</span>
              <input type="file" accept=".lmx,.json,application/json" className="sr-only" onChange={openProjectFile} />
            </label>
            <button type="button" onClick={saveProjectFile} className="inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5">
              <Save className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Save project</span>
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-8 lg:px-12 lg:py-10">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-secondary">Build your graphic</p>
            <h1 className="mt-2 font-display text-4xl font-bold leading-[.92] tracking-[-.07em] sm:text-6xl">Make a moment<br /><span className="text-primary">worth sharing.</span></h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-[#177d76]" /> Stays on your device
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(290px,360px)_1fr]">
          <aside className="order-2 space-y-6 rounded-[22px] border border-border bg-card p-5 lg:order-1 lg:p-6">
            <Section title={project.format === 'card' ? 'Compare card layouts' : 'Starting point'} icon={project.format === 'card' ? LayoutGrid : Sparkles}>
              {project.format === 'card' ? (
                <>
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Your information stays in place while you compare each look.</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {cardLayouts.map((layout) => (
                      <LayoutOption
                        key={layout.id}
                        layout={layout}
                        project={project}
                        selected={project.layout === layout.id}
                        onSelect={() => updateProject('layout', layout.id)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  {templates.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => updateProject('template', item.id)}
                      className={`w-full rounded-xl border p-3 text-left transition-all ${project.template === item.id ? 'border-primary bg-[#fff0e9] ring-1 ring-primary' : 'border-border bg-background hover:border-primary/60'}`}
                      aria-pressed={project.template === item.id}
                    >
                      <span className="block text-sm font-bold">{item.name}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.summary}</span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Output format" icon={FileImage}>
              <div className="grid grid-cols-2 gap-2">
                {formats.map((item) => (
                  <button type="button" key={item.id} onClick={() => updateProject('format', item.id)} className={`rounded-xl border p-3 text-left transition-all ${project.format === item.id ? 'border-primary bg-[#fff0e9] ring-1 ring-primary' : 'border-border bg-background hover:border-primary/60'}`} aria-pressed={project.format === item.id}>
                    <span className="block text-xs font-bold">{item.label}</span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">{item.dimensions}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Player details" icon={Sparkles}>
              <div className="space-y-4">
                <HypeField label="Player name" value={project.playerName} onChange={(value) => updateProject('playerName', value)} placeholder="Add a player name" required />
                <div className="grid grid-cols-2 gap-3">
                  <HypeField label="Jersey number" value={project.jerseyNumber} onChange={(value) => updateProject('jerseyNumber', value)} placeholder="12" />
                  <HypeField label="Position" value={project.position} onChange={(value) => updateProject('position', value)} placeholder="Forward" />
                </div>
                <HypeField label="Team name" value={project.teamName} onChange={(value) => updateProject('teamName', value)} placeholder="Your team" />
                <div className="grid grid-cols-2 gap-3">
                  <HypeField label="Grade / age" value={project.grade} onChange={(value) => updateProject('grade', value)} placeholder="8th grade" />
                  <HypeField label="Short stat" value={project.stat} onChange={(value) => updateProject('stat', value)} placeholder="12 points" />
                </div>
                <HypeField label="Achievement or title" value={project.achievement} onChange={(value) => updateProject('achievement', value)} placeholder="Player of the week" />
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-foreground">Coach message</span>
                  <textarea value={project.coachMessage} onChange={(event) => updateProject('coachMessage', event.target.value)} placeholder="Keep showing up." rows={2} className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-sm font-medium outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </label>
                <div>
                  <p className="mb-2 text-xs font-bold text-foreground">Show on card</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['grade', 'Grade / age'],
                      ['stat', 'Short stat'],
                      ['achievement', 'Achievement'],
                      ['coachMessage', 'Coach message'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex cursor-pointer items-center justify-between gap-2 rounded-xl bg-background px-3 py-2.5 text-[11px] font-bold">
                        {label}
                        <Switch checked={project.visibility[key]} onCheckedChange={(checked) => updateVisibility(key, checked)} aria-label={`Show ${label}`} />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Photos and logo" icon={ImagePlus}>
              <div className="space-y-2">
                <AssetButton label="player photo" hasAsset={Boolean(project.photo)} onChange={photoUpload} onRemove={() => updateProject('photo', null)} />
                <AssetButton label="team logo" hasAsset={Boolean(project.logo)} onChange={logoUpload} onRemove={() => updateProject('logo', null)} />
              </div>
              <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" /> Photos, logos, and player information stay on this device and are not saved by LeagueMatrix.</p>
            </Section>

            <Section title="Team look" icon={Palette}>
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block text-xs font-bold">Color feeling</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(palettes) as PaletteId[]).map((id) => (
                      <button type="button" key={id} onClick={() => updateProject('palette', id)} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-bold transition-all ${project.palette === id ? 'border-primary bg-[#fff0e9] ring-1 ring-primary' : 'border-border bg-background hover:border-primary/60'}`} aria-pressed={project.palette === id}>
                        <span className="flex gap-0.5"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: palettes[id].primary }} /><span className="h-4 w-4 rounded-full" style={{ backgroundColor: palettes[id].secondary }} /></span>
                        {palettes[id].name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block text-xs font-bold">Background treatment</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['gradient', 'solid', 'paper'] as const).map((background) => (
                      <button type="button" key={background} onClick={() => updateProject('background', background)} className={`rounded-xl border px-2 py-2 text-xs font-bold capitalize transition-all ${project.background === background ? 'border-primary bg-[#fff0e9] ring-1 ring-primary' : 'border-border bg-background hover:border-primary/60'}`}>{background}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-background px-3 py-2.5">
                  <div><p className="text-xs font-bold">Motion lines</p><p className="text-[11px] text-muted-foreground">Add a little game-day energy</p></div>
                  <Switch checked={project.overlay} onCheckedChange={(checked) => updateProject('overlay', checked)} aria-label="Toggle motion lines" />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-background px-3 py-2.5">
                  <div><p className="text-xs font-bold">LeagueMatrix mark</p><p className="text-[11px] text-muted-foreground">Show small studio branding</p></div>
                  <Switch checked={project.branding} onCheckedChange={(checked) => updateProject('branding', checked)} aria-label="Toggle LeagueMatrix branding" />
                </div>
              </div>
            </Section>

            <Section title="Photo adjustments" icon={SlidersHorizontal}>
              <div className="space-y-4">
                <RangeControl label="Zoom" value={project.photoTransform.zoom} min={1} max={2.5} step={0.05} display={`${project.photoTransform.zoom.toFixed(2)}×`} onChange={(value) => updateTransform('zoom', value)} />
                <RangeControl label="Brightness" value={project.adjustments.brightness} min={0.5} max={1.6} step={0.05} display={`${Math.round(project.adjustments.brightness * 100)}%`} onChange={(value) => updateAdjustment('brightness', value)} />
                <RangeControl label="Contrast" value={project.adjustments.contrast} min={0.5} max={1.6} step={0.05} display={`${Math.round(project.adjustments.contrast * 100)}%`} onChange={(value) => updateAdjustment('contrast', value)} />
                <RangeControl label="Saturation" value={project.adjustments.saturation} min={0} max={1.8} step={0.05} display={`${Math.round(project.adjustments.saturation * 100)}%`} onChange={(value) => updateAdjustment('saturation', value)} />
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => updateTransform('x', project.photoTransform.x - 12)} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-bold hover:bg-muted" aria-label="Move photo left"><Move className="h-3.5 w-3.5 -rotate-45" /> Left</button>
                  <button type="button" onClick={() => updateTransform('y', project.photoTransform.y - 12)} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-bold hover:bg-muted" aria-label="Move photo up"><Move className="h-3.5 w-3.5 -rotate-90" /> Up</button>
                  <button type="button" onClick={() => updateTransform('x', project.photoTransform.x + 12)} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-bold hover:bg-muted" aria-label="Move photo right"><Move className="h-3.5 w-3.5 rotate-45" /> Right</button>
                  <button type="button" onClick={() => updateTransform('y', project.photoTransform.y + 12)} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-bold hover:bg-muted" aria-label="Move photo down"><Move className="h-3.5 w-3.5 rotate-90" /> Down</button>
                  <button type="button" onClick={() => updateTransform('rotation', project.photoTransform.rotation - 5)} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-bold hover:bg-muted" aria-label="Rotate photo left"><RotateCw className="h-3.5 w-3.5 -scale-x-100" /> Rotate</button>
                  <button type="button" onClick={() => updateTransform('flip', !project.photoTransform.flip)} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-border bg-background text-xs font-bold hover:bg-muted" aria-label="Flip photo horizontally"><FlipHorizontal2 className="h-3.5 w-3.5" /> Flip</button>
                </div>
              </div>
            </Section>

            <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row">
              <Button type="button" variant="outline" onClick={resetProject} className="flex-1 rounded-full">
                Reset
              </Button>
              <Button type="button" onClick={() => setShowAdvanced((current) => !current)} className="flex-[1.35] rounded-full">
                {showAdvanced ? 'Hide export options' : 'Preview & export'} <Download className="h-4 w-4" />
              </Button>
            </div>
            {showAdvanced && (
              <div className="rounded-2xl border border-[#f5c94d] bg-[#fff8dc] p-4">
                <p className="text-xs font-bold text-[#243248]">Ready to share?</p>
                <p className="mt-1 text-xs leading-relaxed text-[#243248]/70">Export uses the selected layout and the same settings shown in the live canvas.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" size="sm" disabled={exporting} onClick={() => void exportImage('png')} className="rounded-full"><Download className="h-3.5 w-3.5" /> PNG</Button>
                  <Button type="button" variant="secondary" size="sm" disabled={exporting} onClick={() => void exportImage('jpeg')} className="rounded-full"><Download className="h-3.5 w-3.5" /> JPEG</Button>
                </div>
                {validation && <p className="mt-3 text-xs font-bold text-destructive" role="alert">{validation}</p>}
              </div>
            )}
          </aside>

          <section className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-24 lg:self-start">
            <div className="mb-4 flex items-center justify-between">
              <div><p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Live canvas</p><p className="mt-1 text-sm text-muted-foreground">{project.format === 'card' ? activeLayout.name : template.name} · {formats.find((item) => item.id === project.format)?.dimensions}</p></div>
              <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#177d76]" /> Local preview</span>
            </div>
            <PreviewCanvas project={project} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#fff5cc] text-[#a87700]"><Lightbulb className="h-4 w-4" /></div><p className="text-xs leading-relaxed text-muted-foreground"><span className="font-bold text-foreground">Keep it punchy.</span> A name, number, and one clear recognition line are enough to make a strong card.</p></div>
              <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#d5ebe6] text-[#177d76]"><ZoomIn className="h-4 w-4" /></div><p className="text-xs leading-relaxed text-muted-foreground"><span className="font-bold text-foreground">Make the crop yours.</span> Add a photo, then use zoom, movement, rotation, and flip to find the moment.</p></div>
            </div>
            {notice && <p className="mt-4 text-center text-xs font-semibold text-secondary sm:hidden" role="status">{notice}</p>}
          </section>
        </div>
      </main>
      <MobilePreviewDialog
        project={project}
        open={mobilePreviewOpen}
        onOpenChange={setMobilePreviewOpen}
        title={project.format === 'card' ? activeLayout.name : template.name}
      />
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><Label className="text-xs font-bold">{label}</Label><span className="text-[11px] font-bold text-muted-foreground">{display}</span></div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next)} aria-label={label} />
    </div>
  );
}

export { HypeCardEditor };