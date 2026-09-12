import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
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

function normalizeProject(project: HypeCardProject): HypeCardProject {
  const defaults = defaultProject();
  return {
    ...defaults,
    ...project,
    layout: project.layout ?? defaults.layout,
    photoTransform: { ...defaults.photoTransform, ...project.photoTransform },
    adjustments: { ...defaults.adjustments, ...project.adjustments },
    visibility: { ...defaults.visibility, ...project.visibility },
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
  reader.onload = () => onLoad(String(reader.result));
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

function buildSluggerCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const frame = { x: 82, y: 172, width: 836, height: 665, radius: 42 };
  const photoX = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${frame.width * project.photoTransform.zoom}" height="${frame.height * project.photoTransform.zoom}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 504px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : `<rect x="82" y="172" width="836" height="665" fill="#0e1b31"/><circle cx="500" cy="405" r="105" fill="${palette.paper}" opacity=".16"/><path d="M250 788 Q500 500 750 788Z" fill="${palette.paper}" opacity=".16"/><text x="500" y="710" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="22" font-weight="800" letter-spacing="6" fill="${palette.paper}" opacity=".62">ADD PLAYER PHOTO</text>`;
  const player = escapeXml(project.playerName || 'YOUR PLAYER');
  const number = escapeXml(project.jerseyNumber || '00');
  const team = escapeXml(project.teamName || 'YOUR TEAM');
  const details = escapeXml([project.position, project.visibility.grade ? project.grade : ''].filter(Boolean).join('  •  ') || 'GAME DAY');
  const recognition = escapeXml([
    project.visibility.achievement ? project.achievement : '',
    project.visibility.stat ? project.stat : '',
  ].filter(Boolean).join('  •  ') || 'MAKE THE MOMENT COUNT');
  const message = escapeXml(project.visibility.coachMessage ? project.coachMessage : '');
  const logo = project.logo
    ? `<image href="${project.logo}" x="422" y="94" width="156" height="104" preserveAspectRatio="xMidYMid meet"/>`
    : `<g transform="translate(500 144)"><path d="M0-52 16-17 54-17 24 6 34 43 0 21-34 43-24 6-54-17-16-17Z" fill="${palette.accent}"/><circle r="65" fill="none" stroke="${palette.paper}" stroke-opacity=".35" stroke-width="3"/></g>`;
  const motion = project.overlay
    ? `<g opacity=".14" stroke="${palette.paper}" stroke-width="4"><path d="M92 250 720 92"/><path d="M168 355 918 167"/><path d="M82 677 818 492"/></g>`
    : '';
  const branding = project.branding
    ? `<text x="500" y="1350" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="${palette.paper}" opacity=".66">LEAGUEMATRIX CREATIVE STUDIO</text>`
    : '';
  const paperBackground = project.background === 'paper';
  const base = paperBackground ? palette.paper : palette.ink;
  const contrastInk = paperBackground ? palette.ink : palette.paper;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs>
      <linearGradient id="cardBg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${base}"/><stop offset=".62" stop-color="${paperBackground ? palette.paper : '#111d33'}"/><stop offset="1" stop-color="${palette.primary}"/></linearGradient>
      <linearGradient id="photoWash" x1="0" y1="0" x2="0" y2="1"><stop offset=".48" stop-color="${palette.ink}" stop-opacity="0"/><stop offset="1" stop-color="${palette.ink}" stop-opacity=".94"/></linearGradient>
      <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="24" stdDeviation="20" flood-color="#0a1424" flood-opacity=".38"/></filter>
      <clipPath id="cardClip"><rect x="30" y="24" width="940" height="1346" rx="72"/></clipPath>
      <clipPath id="verticalPhotoClip"><rect x="82" y="172" width="836" height="665" rx="42"/></clipPath>
    </defs>
    <g filter="url(#cardShadow)"><rect x="30" y="24" width="940" height="1346" rx="72" fill="url(#cardBg)"/></g>
    <g clip-path="url(#cardClip)">
      <path d="M-40 190 565-20H1050V115L120 382Z" fill="${palette.primary}" opacity=".2"/><path d="M-80 284 720-20H1050V42L-20 410Z" fill="${palette.accent}" opacity=".12"/>
      ${motion}
      <text x="92" y="150" font-family="Space Grotesk,sans-serif" font-size="122" font-weight="800" letter-spacing="-10" fill="${palette.accent}" opacity=".18">#${number}</text>
      <rect x="365" y="50" width="270" height="60" rx="30" fill="#08101d" opacity=".52"/><rect x="381" y="64" width="238" height="30" rx="15" fill="${palette.paper}" opacity=".2"/>
      ${logo}
      <g clip-path="url(#verticalPhotoClip)">${photo}</g>
      <rect x="82" y="172" width="836" height="665" rx="42" fill="none" stroke="${palette.paper}" stroke-opacity=".42" stroke-width="6"/>
      <rect x="82" y="172" width="836" height="665" rx="42" fill="url(#photoWash)"/>
      <path d="M0 930Q210 790 435 930T1000 905V1400H0Z" fill="${palette.paper}"/><path d="M0 1010Q220 865 455 1015T1000 980V1400H0Z" fill="${palette.secondary}"/><path d="M0 1095Q230 960 470 1100T1000 1060V1400H0Z" fill="${palette.primary}"/><path d="M0 1180Q240 1050 485 1185T1000 1140V1400H0Z" fill="${palette.ink}"/>
      <rect x="108" y="782" width="784" height="180" rx="32" fill="${palette.primary}" stroke="${palette.paper}" stroke-width="5"/>
      <text x="500" y="875" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="88" font-weight="800" letter-spacing="-5" fill="${palette.paper}">${player}</text>
      <text x="500" y="924" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="21" font-weight="800" letter-spacing="6" fill="${palette.paper}" opacity=".86">${team.toUpperCase()}  •  #${number}</text>
      <text x="500" y="1038" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="21" font-weight="800" letter-spacing="5" fill="${palette.ink}">${details.toUpperCase()}</text>
      <line x1="405" y1="1070" x2="595" y2="1070" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round"/>
      <text x="500" y="1162" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="31" font-weight="800" fill="${palette.paper}">${recognition.toUpperCase()}</text>
      <text x="500" y="1248" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="20" font-weight="700" letter-spacing="2" fill="${palette.paper}" opacity=".82">${message}</text>
      ${branding}
    </g>
    <rect x="30" y="24" width="940" height="1346" rx="72" fill="none" stroke="${palette.primary}" stroke-width="9"/><rect x="48" y="42" width="904" height="1310" rx="56" fill="none" stroke="${contrastInk}" stroke-opacity=".22" stroke-width="3"/>
  </svg>`;
}

function cardContent(project: HypeCardProject) {
  const player = escapeXml(project.playerName || 'YOUR PLAYER');
  const number = escapeXml(project.jerseyNumber || '00');
  const team = escapeXml(project.teamName || 'YOUR TEAM');
  const details = escapeXml([project.position, project.visibility.grade ? project.grade : ''].filter(Boolean).join('  •  ') || 'GAME DAY');
  const recognition = escapeXml([
    project.visibility.achievement ? project.achievement : '',
    project.visibility.stat ? project.stat : '',
  ].filter(Boolean).join('  •  ') || 'MAKE THE MOMENT COUNT');
  const message = escapeXml(project.visibility.coachMessage ? project.coachMessage : '');
  return { player, number, team, details, recognition, message };
}

function buildAllStarCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  const frame = { x: 170, y: 190, width: 660, height: 660 };
  const photoX = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${frame.width * project.photoTransform.zoom}" height="${frame.height * project.photoTransform.zoom}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 520px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : `<circle cx="500" cy="520" r="330" fill="${palette.ink}" opacity=".12"/><circle cx="500" cy="445" r="88" fill="${palette.ink}" opacity=".2"/><path d="M300 820 Q500 530 700 820Z" fill="${palette.ink}" opacity=".2"/><text x="500" y="760" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="20" font-weight="800" letter-spacing="5" fill="${palette.ink}" opacity=".65">ADD PLAYER PHOTO</text>`;
  const logo = project.logo ? `<image href="${project.logo}" x="428" y="72" width="144" height="92" preserveAspectRatio="xMidYMid meet"/>` : `<circle cx="500" cy="118" r="46" fill="${palette.primary}"/><text x="500" y="133" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="44" font-weight="800" fill="${palette.paper}">${content.number}</text>`;
  const message = content.message ? `<text x="500" y="1278" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="19" font-weight="700" letter-spacing="2" fill="${palette.paper}" opacity=".78">${content.message}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs><clipPath id="allStarCircle"><circle cx="500" cy="520" r="330"/></clipPath><linearGradient id="allStarBg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${palette.paper}"/><stop offset="1" stop-color="${palette.secondary}"/></linearGradient></defs>
    <rect width="1000" height="1400" rx="72" fill="url(#allStarBg)"/>
    <path d="M0 0H1000V250Q760 330 500 250T0 250Z" fill="${palette.ink}"/>
    <path d="M0 1115Q220 1030 420 1100T1000 1040V1400H0Z" fill="${palette.ink}"/>
    <path d="M0 1120Q250 1010 510 1118T1000 1060" fill="none" stroke="${palette.accent}" stroke-width="22" opacity=".9"/>
    <text x="500" y="62" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="${palette.paper}" opacity=".7">ALL-STAR PROFILE</text>
    ${logo}
    <circle cx="500" cy="520" r="354" fill="${palette.accent}" opacity=".95"/><circle cx="500" cy="520" r="340" fill="${palette.paper}"/>
    <g clip-path="url(#allStarCircle)">${photo}</g>
    <circle cx="500" cy="520" r="330" fill="none" stroke="${palette.paper}" stroke-width="16"/>
    <text x="500" y="930" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="82" font-weight="800" letter-spacing="-4" fill="${palette.ink}">${content.player}</text>
    <text x="500" y="983" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="20" font-weight="800" letter-spacing="5" fill="${palette.primary}">${content.team.toUpperCase()}  •  #${content.number}</text>
    <text x="500" y="1040" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="19" font-weight="800" letter-spacing="3" fill="${palette.ink}" opacity=".78">${content.details.toUpperCase()}</text>
    <rect x="140" y="1135" width="720" height="94" rx="26" fill="${palette.primary}"/><text x="500" y="1195" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="27" font-weight="800" fill="${palette.paper}">${content.recognition.toUpperCase()}</text>
    ${message}<rect x="30" y="24" width="940" height="1346" rx="72" fill="none" stroke="${palette.primary}" stroke-width="9"/>
  </svg>`;
}

function buildRookieCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  const frame = { x: 96, y: 190, width: 808, height: 650 };
  const photoX = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${frame.width * project.photoTransform.zoom}" height="${frame.height * project.photoTransform.zoom}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 515px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : `<rect x="96" y="190" width="808" height="650" fill="#12243b"/><circle cx="500" cy="420" r="96" fill="${palette.paper}" opacity=".18"/><path d="M260 805Q500 520 740 805Z" fill="${palette.paper}" opacity=".18"/><text x="500" y="730" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="20" font-weight="800" letter-spacing="5" fill="${palette.paper}" opacity=".65">ADD PLAYER PHOTO</text>`;
  const logo = project.logo ? `<image href="${project.logo}" x="770" y="76" width="125" height="82" preserveAspectRatio="xMidYMid meet"/>` : '';
  const message = content.message ? `<text x="95" y="1290" font-family="DM Sans,sans-serif" font-size="19" font-weight="700" fill="${palette.paper}" opacity=".74">${content.message}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs><clipPath id="rookiePhoto"><path d="M96 190H904V770L96 840Z"/></clipPath><linearGradient id="rookieBg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.ink}"/><stop offset="1" stop-color="${palette.secondary}"/></linearGradient></defs>
    <rect width="1000" height="1400" rx="72" fill="url(#rookieBg)"/><path d="M0 0H1000V330L0 650Z" fill="${palette.primary}" opacity=".18"/><rect x="66" y="24" width="24" height="1346" rx="12" fill="${palette.accent}"/>
    <text x="96" y="132" font-family="Space Grotesk,sans-serif" font-size="25" font-weight="800" letter-spacing="6" fill="${palette.paper}" opacity=".78">ROOKIE CARD</text>${logo}
    <text x="62" y="1000" font-family="Space Grotesk,sans-serif" font-size="290" font-weight="800" letter-spacing="-20" fill="${palette.accent}" opacity=".2">#${content.number}</text>
    <g clip-path="url(#rookiePhoto)">${photo}</g><path d="M96 190H904V770L96 840Z" fill="none" stroke="${palette.accent}" stroke-width="8"/>
    <rect x="96" y="815" width="808" height="140" fill="${palette.paper}"/><text x="130" y="895" font-family="Space Grotesk,sans-serif" font-size="72" font-weight="800" letter-spacing="-4" fill="${palette.ink}">${content.player}</text>
    <text x="130" y="1005" font-family="DM Sans,sans-serif" font-size="22" font-weight="800" letter-spacing="4" fill="${palette.paper}">${content.team.toUpperCase()}  •  ${content.details.toUpperCase()}</text>
    <rect x="96" y="1045" width="808" height="134" rx="18" fill="${palette.primary}"/><text x="130" y="1105" font-family="DM Sans,sans-serif" font-size="18" font-weight="800" letter-spacing="3" fill="${palette.paper}" opacity=".75">SEASON HIGHLIGHT</text><text x="130" y="1152" font-family="Space Grotesk,sans-serif" font-size="29" font-weight="800" fill="${palette.paper}">${content.recognition.toUpperCase()}</text>
    ${message}<text x="904" y="1348" text-anchor="end" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="4" fill="${palette.paper}" opacity=".56">LEAGUEMATRIX</text><rect x="30" y="24" width="940" height="1346" rx="72" fill="none" stroke="${palette.accent}" stroke-width="9"/>
  </svg>`;
}

function buildDugoutCardSvg(project: HypeCardProject) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  const frame = { x: 106, y: 190, width: 788, height: 610 };
  const photoX = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${frame.width * project.photoTransform.zoom}" height="${frame.height * project.photoTransform.zoom}" preserveAspectRatio="xMidYMid slice" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:500px 495px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : `<rect x="106" y="190" width="788" height="610" fill="${palette.ink}" opacity=".14"/><circle cx="500" cy="410" r="92" fill="${palette.ink}" opacity=".18"/><path d="M275 770Q500 510 725 770Z" fill="${palette.ink}" opacity=".18"/><text x="500" y="690" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="20" font-weight="800" letter-spacing="5" fill="${palette.ink}" opacity=".62">ADD PLAYER PHOTO</text>`;
  const logo = project.logo ? `<image href="${project.logo}" x="108" y="66" width="112" height="80" preserveAspectRatio="xMidYMid meet"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400">
    <defs><clipPath id="dugoutPhoto"><rect x="106" y="190" width="788" height="610" rx="28"/></clipPath></defs>
    <rect width="1000" height="1400" rx="72" fill="${palette.paper}"/><rect y="0" width="1000" height="168" fill="${palette.ink}"/><path d="M0 168H1000L880 230H120Z" fill="${palette.primary}"/>
    ${logo}<text x="880" y="92" text-anchor="end" font-family="DM Sans,sans-serif" font-size="17" font-weight="800" letter-spacing="4" fill="${palette.paper}" opacity=".76">GAME DAY / ${content.number}</text>
    <rect x="76" y="160" width="848" height="678" rx="36" fill="${palette.paper}" stroke="${palette.primary}" stroke-width="8"/><g clip-path="url(#dugoutPhoto)">${photo}</g><rect x="106" y="190" width="788" height="610" rx="28" fill="none" stroke="${palette.paper}" stroke-width="5"/>
    <rect x="76" y="875" width="848" height="258" rx="28" fill="${palette.ink}"/><text x="118" y="958" font-family="DM Sans,sans-serif" font-size="18" font-weight="800" letter-spacing="4" fill="${palette.accent}">PLAYER SPOTLIGHT</text><text x="118" y="1035" font-family="Space Grotesk,sans-serif" font-size="70" font-weight="800" letter-spacing="-4" fill="${palette.paper}">${content.player}</text><text x="118" y="1088" font-family="DM Sans,sans-serif" font-size="19" font-weight="800" letter-spacing="3" fill="${palette.paper}" opacity=".75">${content.team.toUpperCase()}  •  ${content.details.toUpperCase()}</text>
    <rect x="76" y="1170" width="848" height="100" rx="24" fill="${palette.primary}"/><text x="500" y="1232" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="27" font-weight="800" fill="${palette.paper}">${content.recognition.toUpperCase()}</text><text x="500" y="1318" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="18" font-weight="700" fill="${palette.ink}" opacity=".7">${escapeXml(content.message || 'BRING THE ENERGY.')}</text><rect x="30" y="24" width="940" height="1346" rx="72" fill="none" stroke="${palette.ink}" stroke-width="9"/>
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
        className="max-h-[76vh] w-full max-w-[760px] overflow-hidden rounded-[18px] shadow-[14px_18px_0_rgba(36,50,72,.14)]"
        style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}
        data-testid="hype-preview-canvas"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
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
        <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: svg }} />
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
      <div className="border-b border-border bg-background">
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

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
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

          <section className="order-1 min-w-0 lg:order-2">
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