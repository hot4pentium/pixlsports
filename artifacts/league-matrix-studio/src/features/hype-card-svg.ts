import { 
  HypeCardProject, 
  HypeFormat, 
  palettes, 
  getDimensions, 
  escapeXml,
  templates
} from './hype-card-types';
import { buildStadiumCardClipMarkup, buildStadiumLowerThirdTextMarkup } from './hype-card-geometry';
import { buildPositionBadgeMarkup } from './position-badge';
import stadiumEntrance from '../assets/hype-cards/stadium-entrance.webp?url&inline';
import sunsetStadium from '../assets/hype-cards/sunset-stadium.webp?url&inline';
import lockerRoomWalkout from '../assets/hype-cards/locker-room-walkout.webp?url&inline';
import splitLightArena from '../assets/hype-cards/split-light-arena.webp?url&inline';

export function getPhotoFrame(format: HypeFormat) {
  const { width, height } = getDimensions(format);
  if (format === 'landscape') {
    const frameWidth = width * 0.48;
    const frameHeight = frameWidth * 9 / 16;
    return { x: 70, y: (height - frameHeight) / 2, width: frameWidth, height: frameHeight, radius: 38 };
  }
  if (format === 'story') return { x: 70, y: 135, width: width - 140, height: height * 0.43, radius: 38 };
  if (format === 'card') return { x: 60, y: 95, width: width - 120, height: height * 0.42, radius: 34 };
  return { x: 60, y: 90, width: width - 120, height: height * 0.47, radius: 38 };
}

export function fitText(text: string, maxWidth: number, baseSize: number, charWidthRatio = 0.65, letterSpacing = 0) {
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
    <text x="500" y="665" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="34" font-weight="800" letter-spacing="10" fill="#ffffff">ADD PLAYER MEDIA</text>
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

function getFinishBackground(project: HypeCardProject, ns: string) {
  if (project.finish === 'classic') return '';
  if (project.finish === 'cosmic-clash') return `
    <rect width="1000" height="1400" fill="#031535" opacity=".72"/>
    <circle cx="180" cy="300" r="430" fill="#0868ff" opacity=".38" filter="url(#blur10-${ns})"/>
    <circle cx="850" cy="1100" r="460" fill="#ff5a00" opacity=".34" filter="url(#blur10-${ns})"/>
    <path d="M-100 1180 Q430 900 1100 180M-80 1280 Q500 960 1080 310" fill="none" stroke="#39a6ff" stroke-width="18" opacity=".4" filter="url(#neonGlow-${ns})"/>
    <path d="M-80 1240 Q500 1120 1080 620" fill="none" stroke="#ff7900" stroke-width="24" opacity=".45" filter="url(#neonGlow-${ns})"/>`;
  if (project.finish === 'gold-spotlight') return `
    <rect width="1000" height="1400" fill="#031812" opacity=".82"/>
    <path d="M120 0 L460 1120 L-50 1120 ZM880 0 L1050 1120 L540 1120 Z" fill="url(#lightRay-${ns})" opacity=".55"/>
    <ellipse cx="500" cy="1190" rx="390" ry="95" fill="#f4c64b" opacity=".24" filter="url(#blur10-${ns})"/>
    <g fill="#ffd86a" opacity=".65">${Array.from({length: 18}, (_, i) => `<circle cx="${80 + (i * 137) % 850}" cy="${180 + (i * 211) % 1020}" r="${4 + (i % 7)}"/>`).join('')}</g>`;
  if (project.finish === 'neon-prism') return `
    <rect width="1000" height="1400" fill="#08051e" opacity=".78"/>
    <circle cx="150" cy="760" r="420" fill="#e600c7" opacity=".25" filter="url(#blur10-${ns})"/>
    <circle cx="860" cy="470" r="390" fill="#008cff" opacity=".28" filter="url(#blur10-${ns})"/>
    <path d="M-100 310 L700 -30M-60 1060 L1080 520M180 1420 L1080 890" stroke="#f12ddd" stroke-width="12" opacity=".55" filter="url(#neonGlow-${ns})"/>
    <path d="M-80 410 L820 -40M-100 1140 L1080 650" stroke="#18bfff" stroke-width="9" opacity=".65" filter="url(#neonGlow-${ns})"/>`;
  return `
    <rect width="1000" height="1400" fill="#071322" opacity=".72"/>
    <g opacity=".72" filter="url(#blur6-${ns})">
      <circle cx="80" cy="260" r="210" fill="#e62929"/><circle cx="900" cy="310" r="230" fill="#1369d5"/>
      <circle cx="130" cy="1120" r="240" fill="#f4b51b"/><circle cx="880" cy="1110" r="250" fill="#e62929"/>
    </g>
    <g fill="#fff" opacity=".5">${Array.from({length: 22}, (_, i) => `<circle cx="${30 + (i * 173) % 940}" cy="${120 + (i * 239) % 1180}" r="${3 + (i % 9)}"/>`).join('')}</g>`;
}

function getFinishForeground(project: HypeCardProject, ns: string) {
  if (project.finish === 'classic') return '';
  const colors = project.finish === 'cosmic-clash' ? ['#3fa7ff', '#ff7200']
    : project.finish === 'gold-spotlight' ? ['#ffe17b', '#b57b12']
    : project.finish === 'neon-prism' ? ['#f035dd', '#29c8ff']
    : ['#ef3030', '#176ce0'];
  const shards = project.finish === 'neon-prism'
    ? `<path d="M45 210 L180 80 L125 300ZM955 250 L820 95 L890 340ZM40 1110 L190 1260 L95 1040ZM960 1080 L820 1280 L900 1010" fill="${colors[1]}" opacity=".34"/>`
    : '';
  const motif = project.finish === 'cosmic-clash'
    ? `<path d="M-80 1030 Q360 780 1080 260" fill="none" stroke="#168cff" stroke-width="12" opacity=".7" filter="url(#neonGlow-${ns})"/><path d="M-60 1160 Q510 1040 1070 670" fill="none" stroke="#ff6a00" stroke-width="16" opacity=".72" filter="url(#neonGlow-${ns})"/>`
    : project.finish === 'gold-spotlight'
      ? `<path d="M150 45 L390 610 L40 420ZM850 45 L960 420 L610 610" fill="#ffd86a" opacity=".14"/><g fill="#ffe27a">${Array.from({length: 16}, (_, i) => `<circle cx="${60 + (i * 223) % 880}" cy="${120 + (i * 307) % 1160}" r="${3 + (i % 6)}" opacity=".75"/>`).join('')}</g>`
      : project.finish === 'paint-impact'
        ? `<g opacity=".8"><circle cx="65" cy="320" r="70" fill="#ed2929"/><circle cx="110" cy="380" r="28" fill="#fff"/><circle cx="925" cy="330" r="82" fill="#176ce0"/><circle cx="70" cy="1080" r="88" fill="#f7b51b"/><circle cx="930" cy="1050" r="74" fill="#ed2929"/></g>`
        : '';
  return `
    <g clip-path="url(#cardClip-${ns})" pointer-events="none">
      ${shards}
      ${motif}
      <path d="M42 190 L42 42 L190 42M810 42 L958 42 L958 190M42 1210 L42 1358 L190 1358M810 1358 L958 1358 L958 1210" fill="none" stroke="${colors[0]}" stroke-width="16" filter="url(#neonGlow-${ns})"/>
      <path d="M55 205 L55 55 L205 55M795 55 L945 55 L945 205M55 1195 L55 1345 L205 1345M795 1345 L945 1345 L945 1195" fill="none" stroke="${colors[1]}" stroke-width="6"/>
      ${getFlare(500, 42, 2.2, ns, colors[0])}
    </g>`;
}

function cardContent(project: HypeCardProject) {
  const headlineStr = escapeXml(project.headline).toUpperCase();
  const player = escapeXml((project.playerName || 'YOUR PLAYER').toUpperCase());
  const number = escapeXml(project.jerseyNumber || '00');
  const team = escapeXml((project.teamName || 'YOUR TEAM').toUpperCase());
  const details = escapeXml(project.position || 'GAME DAY').toUpperCase();
  return { headline: headlineStr, player, number, team, details, recognition: '', message: '' };
}

export type SvgLayer = 'all' | 'bg' | 'fg';

export const STADIUM_MEDIA_FRAME = { x: 180, y: 330, width: 640, height: 755, radius: 34 } as const;

const stadiumCardBackgrounds = {
  slugger: stadiumEntrance,
  'all-star': sunsetStadium,
  rookie: lockerRoomWalkout,
  dugout: splitLightArena,
} as const;

function buildStadiumCardSvg(project: HypeCardProject, layer: SvgLayer, ns: string) {
  const content = cardContent(project);
  const palette = palettes[project.palette];
  const backgroundImage = stadiumCardBackgrounds[project.layout];
  const frame = STADIUM_MEDIA_FRAME;
  const hypeRailWidth = 58;
  const hypeRailCenterX = (frame.x + frame.width + 1000) / 2;
  const hypeRailX = hypeRailCenterX - hypeRailWidth / 2;
  const stadiumHeadline = content.headline ? `${content.headline.replace(/!+$/, '')}!` : '';
  const photoX = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom;
  const photoHeight = frame.height * project.photoTransform.zoom;
  const headlineSize = fitText(stadiumHeadline, 840, 132, 0.56, 1);
  const playerSize = fitText(content.player, 760, 76, 0.7, 2);
  const detailsLine = content.team;
  const lowerThirdPlayer = project.playerName.trim() ? content.player : '';
  const lowerThirdDetails = project.teamName.trim() ? detailsLine : '';
  const lowerThirdPlayerSize = lowerThirdPlayer ? fitText(lowerThirdPlayer, 760, 76, 0.7, 2) : 0;
  const lowerThirdDetailsSize = lowerThirdDetails ? fitText(lowerThirdDetails, 620, 23, 0.63, 3) : 0;
  const positionBadgeMarkup = buildPositionBadgeMarkup(project.position, palette.secondary, palette.accent);
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid meet" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:${photoX + photoWidth / 2}px ${photoY + photoHeight / 2}px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
    : '';
  const logo = project.logo
    ? `<image href="${project.logo}" x="825" y="128" width="90" height="90" preserveAspectRatio="xMidYMid meet" filter="url(#stadiumShadow-${ns})"/>`
    : '';
  const placeholder = !project.mediaType && !project.photo
    ? `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="#02070e" fill-opacity=".34" stroke="#fff" stroke-opacity=".38" stroke-width="3" stroke-dasharray="14 14"/><text x="500" y="710" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="25" font-weight="800" letter-spacing="7" fill="#fff" opacity=".82">ADD PLAYER MEDIA</text>`
    : '';
  const coachMessage = content.message
     ? `<text x="500" y="1344" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 780, 18, 0.62, 2)}" font-weight="600" letter-spacing="2" fill="#fff" opacity=".72">${content.message}</text>`
    : '';
  const branding = project.branding
     ? `<text x="500" y="1398" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="13" font-weight="800" letter-spacing="5" fill="#fff" opacity=".5">PIXL SPORTS STUDIO</text>`
    : '';
  const nameplate = lowerThirdPlayer || lowerThirdDetails
    ? buildStadiumLowerThirdTextMarkup({
      player: lowerThirdPlayer,
      details: lowerThirdDetails,
      playerSize: lowerThirdPlayerSize,
      detailsSize: lowerThirdDetailsSize,
      accent: palette.accent,
      ns,
    })
    : '';
  const mediaGlow = project.mediaType || project.photo
    ? `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="none" stroke="${palette.primary}" stroke-width="8" stroke-opacity=".58" filter="url(#stadiumMediaGlow-${ns})"/><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="none" stroke="${palette.accent}" stroke-width="3" stroke-opacity=".82"/>`
    : '';
  const defs = `
     ${buildStadiumCardClipMarkup(ns)}
    <clipPath id="stadiumPhotoClip-${ns}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}"/></clipPath>
    <linearGradient id="stadiumTop-${ns}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#02060d" stop-opacity=".9"/><stop offset="1" stop-color="#02060d" stop-opacity="0"/></linearGradient>
    <linearGradient id="stadiumBottom-${ns}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#02060d" stop-opacity="0"/><stop offset=".35" stop-color="#02060d" stop-opacity=".76"/><stop offset="1" stop-color="#02060d" stop-opacity=".96"/></linearGradient>
    <filter id="stadiumShadow-${ns}" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity=".85"/></filter>
    <filter id="stadiumMediaGlow-${ns}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="14" result="softGlow"/><feMerge><feMergeNode in="softGlow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const bgContent = `<g clip-path="url(#stadiumCardClip-${ns})"><image href="${backgroundImage}" x="0" y="0" width="1000" height="1400" preserveAspectRatio="xMidYMid slice"/></g>`;
  const fgContent = `
    <g clip-path="url(#stadiumCardClip-${ns})">
      <rect width="1000" height="330" fill="url(#stadiumTop-${ns})"/>
      <rect y="900" width="1000" height="500" fill="url(#stadiumBottom-${ns})"/>
      ${mediaGlow}
      ${placeholder}
       <g aria-label="Player number and position">
          <path d="M62 46 H208 L226 64 V114 H62 Z" fill="#020811" stroke="${palette.primary}" stroke-width="3"/>
          <text x="86" y="95" font-family="Space Grotesk,sans-serif" font-size="27" font-weight="800" letter-spacing="2" fill="#fff">#${content.number}</text>
          ${positionBadgeMarkup}
       </g>
      <text x="500" y="250" text-anchor="middle" font-family="Oswald,Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif" font-size="${headlineSize}" font-weight="700" letter-spacing="1" fill="#fff" filter="url(#stadiumShadow-${ns})">${stadiumHeadline}</text>
      <g aria-label="Hype Card">
        <rect x="${hypeRailX}" y="500" width="${hypeRailWidth}" height="380" rx="26" fill="#02070e" fill-opacity=".78" stroke="${palette.accent}" stroke-width="3" stroke-opacity=".9"/>
         <text x="${hypeRailCenterX}" y="690" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ${hypeRailCenterX} 690)" font-family="Oswald,Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif" font-size="28" font-weight="700" letter-spacing="12" fill="${palette.accent}" stroke="#02070e" stroke-width="3" paint-order="stroke fill" filter="url(#stadiumShadow-${ns})">HYPE CARD</text>
      </g>
      ${coachMessage}
      ${logo}
      ${branding}
     </g>
     ${nameplate}`;
  const photoMarkup = `<g clip-path="url(#stadiumPhotoClip-${ns})">${photo}</g>`;
  if (layer === 'bg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}</svg>`;
  if (layer === 'fg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${fgContent}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}${photoMarkup}${fgContent}</svg>`;
}

function buildSluggerCardSvg(project: HypeCardProject, layer: SvgLayer, ns: string) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  
  const frame = { x: 33, y: 33, width: 934, height: 1334 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid meet" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:${photoX + photoWidth / 2}px ${photoY + photoHeight / 2}px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
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
    ? `<text x="500" y="1310" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">PIXL SPORTS STUDIO</text>`
    : '';

  const coachMessage = content.message ? `<text x="500" y="1285" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 800, 18, 0.65)}" font-weight="700" letter-spacing="3" fill="#fff" opacity="0.8">${content.message}</text>` : '';
  const recY = content.message ? 1255 : 1275;
  const headlineSize = fitText(content.headline, 900, 280, 0.65, -10);

  const bgContent = `
    <rect width="1000" height="1400" rx="45" fill="#000" />
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      ${getFinishBackground(project, ns)}
      ${!project.mediaType && !project.photo ? getArenaBg(palette, ns) : ''}
    </g>
  `;
  const fgContent = `
    <g clip-path="url(#cardClip-${ns})">
      <rect x="30" y="30" width="940" height="1340" fill="url(#fadeToDark-${ns})" opacity="0.5"/>
      <rect x="30" y="700" width="940" height="670" fill="url(#fadeToDark-${ns})" opacity="0.8"/>
      
      ${motion}
      <text x="500" y="900" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="700" font-weight="800" letter-spacing="-20" fill="#fff" opacity="0.05">#${content.number}</text>
      ${logo}

      <g transform="translate(500, 240)">
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="-10" fill="#000" stroke="#000" stroke-width="34" transform="translate(0, 16)"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="-10" fill="none" stroke="${palette.primary}" stroke-width="26" transform="translate(0, 8)" filter="url(#neonGlowTeam-${ns})"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="-10" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="6" filter="url(#dropShadowSmall-${ns})">${content.headline}</text>
      </g>

      ${getFlare(200, 100, 3, ns, '#fff')}
      ${getFlare(800, 260, 2.5, ns, palette.accent)}
      
      <path d="M 10 1080 L 990 930 L 990 1400 L 10 1400 Z" fill="#000" filter="url(#dropShadow-${ns})" />
      <path d="M 10 1080 L 990 930 L 990 1400 L 10 1400 Z" fill="url(#chromeDark-${ns})" />
      <path d="M 10 1080 L 990 930 L 990 1400 L 10 1400 Z" fill="url(#carbonFiber-${ns})" opacity="0.9"/>
      
      <path d="M -10 1080 L 1010 930" stroke="#000" stroke-width="28" filter="url(#dropShadow-${ns})" />
      <path d="M -10 1080 L 1010 930" stroke="url(#metalCore-${ns})" stroke-width="18" />
      <path d="M -10 1088 L 1010 938" stroke="${palette.accent}" stroke-width="6" filter="url(#neonGlowTeam-${ns})" />

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
    ${getFinishForeground(project, ns)}
  `;

  const defs = `<clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath>${getPremiumDefs(palette, ns)}`;
  if (layer === 'bg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}</svg>`;
  if (layer === 'fg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${fgContent}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}<g clip-path="url(#cardClip-${ns})">${photo}</g>${fgContent}</svg>`;
}

function buildAllStarCardSvg(project: HypeCardProject, layer: SvgLayer, ns: string) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  
  const frame = { x: 150, y: 300, width: 700, height: 700 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid meet" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:${photoX + photoWidth / 2}px ${photoY + photoHeight / 2}px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
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
    ? `<text x="500" y="1320" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">PIXL SPORTS STUDIO</text>`
    : '';
    
  const coachMessage = content.message ? `<text x="500" y="1295" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 600, 18, 0.65, 3)}" font-weight="700" letter-spacing="3" fill="#fff" opacity="0.8">${content.message}</text>` : '';
  const recY = content.message ? 1242 : 1262;
  const headlineSize = fitText(content.headline, 800, 180, 0.65, 4);

  const bgContent = `
    <rect width="1000" height="1400" rx="45" fill="#000" />
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      ${getFinishBackground(project, ns)}
      ${!project.mediaType && !project.photo ? getArenaBg(palette, ns) : ''}
      <circle cx="500" cy="700" r="450" fill="${palette.primary}" opacity="0.65" filter="url(#blur10-${ns})" />
      ${motion}
      <g transform="translate(500, 180)">
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="4" fill="#000" stroke="#000" stroke-width="28" transform="translate(0, 14)"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="4" fill="none" stroke="${palette.accent}" stroke-width="22" transform="translate(0, 7)" filter="url(#neonGlowTeam-${ns})"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="4" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="5" filter="url(#dropShadowSmall-${ns})">${content.headline}</text>
      </g>
      <path d="M 500 230 C 760 230, 900 420, 900 720 C 900 990, 500 1180, 500 1180 C 500 1180, 100 990, 100 720 C 100 420, 240 230, 500 230 Z" fill="#000" filter="url(#dropShadow-${ns})" />
      <path d="M 500 230 C 760 230, 900 420, 900 720 C 900 990, 500 1180, 500 1180 C 500 1180, 100 990, 100 720 C 100 420, 240 230, 500 230 Z" fill="url(#teamMetal-${ns})" />
      <path d="M 500 250 C 740 250, 880 430, 880 720 C 880 970, 500 1150, 500 1150 C 500 1150, 120 970, 120 720 C 120 430, 260 250, 500 250 Z" fill="#000" />
    </g>
  `;

  const fgContent = `
    <g clip-path="url(#cardClip-${ns})">
      <g clip-path="url(#shieldClip-${ns})">
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
    ${getFinishForeground(project, ns)}
  `;

  const defs = `<clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath><clipPath id="shieldClip-${ns}"><path d="M 500 250 C 740 250, 880 430, 880 720 C 880 970, 500 1150, 500 1150 C 500 1150, 120 970, 120 720 C 120 430, 260 250, 500 250 Z" /></clipPath>${getPremiumDefs(palette, ns)}`;
  if (layer === 'bg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}</svg>`;
  if (layer === 'fg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${fgContent}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}<g clip-path="url(#shieldClip-${ns})">${photo}</g>${fgContent}</svg>`;
}

function buildRookieCardSvg(project: HypeCardProject, layer: SvgLayer, ns: string) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  
  const frame = { x: 33, y: 33, width: 934, height: 1334 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid meet" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:${photoX + photoWidth / 2}px ${photoY + photoHeight / 2}px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
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
    ? `<text x="940" y="1335" text-anchor="end" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">PIXL SPORTS</text>`
    : '';

  const coachMessage = content.message ? `<text x="70" y="1335" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 600, 18, 0.65, 2)}" font-weight="700" letter-spacing="2" fill="#fff" opacity="0.7">${content.message}</text>` : '';
  const headlineSize = fitText(content.headline, 900, 140, 0.65, 16);

  const bgContent = `
    <rect width="1000" height="1400" rx="45" fill="#000" />
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      ${getFinishBackground(project, ns)}
      ${!project.mediaType && !project.photo ? getArenaBg(palette, ns) : ''}
      <text x="60" y="1050" font-family="Space Grotesk,sans-serif" font-size="550" font-weight="800" letter-spacing="-30" fill="url(#teamMetal-${ns})" opacity="0.4" filter="url(#dropShadow-${ns})">#${content.number}</text>
    </g>
  `;

  const fgContent = `
    <g clip-path="url(#cardClip-${ns})">
      <g clip-path="url(#rookiePhoto-${ns})">
        <rect x="30" y="550" width="940" height="550" fill="url(#fadeToDark-${ns})" opacity="0.8"/>
      </g>
      ${motion}
      <path d="M -10 1110 L 1010 840" stroke="#000" stroke-width="34" filter="url(#dropShadow-${ns})" />
      <path d="M -10 1110 L 1010 840" stroke="url(#metalCore-${ns})" stroke-width="24" />
      <path d="M -10 1118 L 1010 848" stroke="${palette.accent}" stroke-width="8" filter="url(#neonGlowTeam-${ns})" />
      
      <g transform="translate(110, 420) rotate(-90)">
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="16" fill="#000" stroke="#000" stroke-width="20" transform="translate(0,10)"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="16" fill="none" stroke="${palette.accent}" stroke-width="16" transform="translate(0,5)" filter="url(#neonGlowTeam-${ns})"></text>
        <text x="0" y="0" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="16" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="4" filter="url(#dropShadowSmall-${ns})">${content.headline}</text>
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
    ${getFinishForeground(project, ns)}
  `;

  const defs = `<clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath><clipPath id="rookiePhoto-${ns}"><path d="M 30 30 L 970 30 L 970 850 L 30 1100 Z" /></clipPath>${getPremiumDefs(palette, ns)}`;
  if (layer === 'bg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}</svg>`;
  if (layer === 'fg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${fgContent}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}<g clip-path="url(#rookiePhoto-${ns})">${photo}</g>${fgContent}</svg>`;
}

function buildDugoutCardSvg(project: HypeCardProject, layer: SvgLayer, ns: string) {
  const palette = palettes[project.palette];
  const content = cardContent(project);
  
  const frame = { x: 70, y: 240, width: 860, height: 660 };
  const overscan = 200;
  const photoX = frame.x - overscan / 2 + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y - overscan / 2 + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom + overscan;
  const photoHeight = frame.height * project.photoTransform.zoom + overscan;
  
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid meet" style="filter:brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation});transform-origin:${photoX + photoWidth / 2}px ${photoY + photoHeight / 2}px;transform:rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})"/>`
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
    ? `<text x="500" y="1330" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="14" font-weight="800" letter-spacing="5" fill="#fff" opacity="0.6">PIXL SPORTS STUDIO</text>`
    : '';

  const coachMessage = content.message ? `<text x="930" y="1255" text-anchor="end" font-family="DM Sans,sans-serif" font-size="${fitText(content.message, 400, 18, 0.65, 2)}" font-weight="700" letter-spacing="2" fill="#fff" opacity="0.7">${content.message}</text>` : '';
  const recWidth = content.message ? 380 : 800;
  const headlineSize = fitText(content.headline, 480, 82, 0.65, 8);

  const bgContent = `
    <rect width="1000" height="1400" rx="45" fill="#000" />
    <g clip-path="url(#cardClip-${ns})">
      ${getCardBackground(project, ns)}
      ${getFinishBackground(project, ns)}
      ${!project.mediaType && !project.photo ? getArenaBg(palette, ns) : ''}
      <path d="M 30 30 L 970 30 L 970 200 L 780 200 L 720 120 L 30 120 Z" fill="url(#teamMetal-${ns})" />
      ${logo}
      <text x="940" y="90" text-anchor="end" font-family="Space Grotesk,sans-serif" font-size="46" font-weight="800" letter-spacing="4" fill="#fff" filter="url(#dropShadowSmall-${ns})">#${content.number}</text>
      
      <g transform="translate(500, 160)">
        <rect x="-260" y="-65" width="520" height="130" fill="#000" rx="25" stroke="#000" stroke-width="20" filter="url(#dropShadow-${ns})"/>
        <rect x="-260" y="-65" width="520" height="130" fill="url(#chromeDark-${ns})" stroke="url(#metalCore-${ns})" stroke-width="10" rx="25" />
        <rect x="-252" y="-57" width="504" height="114" fill="url(#carbonFiber-${ns})" rx="19" />
        <text x="0" y="22" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="8" fill="none" stroke="${palette.accent}" stroke-width="12" filter="url(#neonGlowTeam-${ns})">${content.headline}</text>
        <text x="0" y="22" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="8" fill="url(#chromeText-${ns})" stroke="url(#metalCore-${ns})" stroke-width="2">${content.headline}</text>
      </g>

      <path d="M 720 120 L 970 120" stroke="${palette.accent}" stroke-width="8" filter="url(#neonGlowTeam-${ns})" />
      ${motion}
      <rect x="50" y="220" width="900" height="700" rx="35" fill="#0a0a0a" stroke="url(#metalCore-${ns})" stroke-width="16" filter="url(#dropShadow-${ns})" />
    </g>
  `;

  const fgContent = `
    <g clip-path="url(#cardClip-${ns})">
      <g clip-path="url(#dugoutPhoto-${ns})">
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
    ${getFinishForeground(project, ns)}
  `;

  const defs = `<clipPath id="cardClip-${ns}"><rect x="33" y="33" width="934" height="1334" rx="27" /></clipPath><clipPath id="dugoutPhoto-${ns}"><rect x="70" y="240" width="860" height="660" rx="25" /></clipPath>${getPremiumDefs(palette, ns)}`;
  if (layer === 'bg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}</svg>`;
  if (layer === 'fg') return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${fgContent}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><defs>${defs}</defs>${bgContent}<g clip-path="url(#dugoutPhoto-${ns})">${photo}</g>${fgContent}</svg>`;
}

export function buildHypeCardSvg(project: HypeCardProject, layer: SvgLayer = 'all', ns = 'ns') {
  if (project.format === 'card') {
    return buildStadiumCardSvg(project, layer, ns);
  }
  
  const { width, height } = getDimensions(project.format);
  const palette = palettes[project.palette];
  const frame = getPhotoFrame(project.format);
  const photoX = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const photoY = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const photoWidth = frame.width * project.photoTransform.zoom;
  const photoHeight = frame.height * project.photoTransform.zoom;
  const isLandscape = project.format === 'landscape';
  const isStory = project.format === 'story';
  const template = templates.find((item) => item.id === project.template) ?? templates[0];
  const photo = project.photo
    ? `<image href="${project.photo}" x="${photoX}" y="${photoY}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid meet" style="filter: brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation}); transform-origin: ${photoX + photoWidth / 2}px ${photoY + photoHeight / 2}px; transform: rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})" />`
    : `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="${palette.ink}" opacity=".16"/><circle cx="${frame.x + frame.width / 2}" cy="${frame.y + frame.height * .42}" r="${Math.min(frame.width, frame.height) * .12}" fill="${palette.paper}" opacity=".7"/><path d="M ${frame.x + frame.width * .26} ${frame.y + frame.height * .88} Q ${frame.x + frame.width / 2} ${frame.y + frame.height * .52} ${frame.x + frame.width * .74} ${frame.y + frame.height * .88}" fill="${palette.paper}" opacity=".7"/><text x="${frame.x + frame.width / 2}" y="${frame.y + frame.height * .96}" text-anchor="middle" font-size="${Math.max(18, width * .018)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${palette.paper}" opacity=".9">ADD PLAYER MEDIA</text>`;
  const logo = project.logo
    ? `<image href="${project.logo}" x="${width - (isLandscape ? 190 : 150)}" y="${isStory ? 150 : 65}" width="${isLandscape ? 110 : 90}" height="${isLandscape ? 110 : 90}" preserveAspectRatio="xMidYMid meet" />`
    : '';
  const background = project.background === 'solid'
    ? `<rect width="${width}" height="${height}" fill="${palette.ink}"/>`
    : project.background === 'paper'
      ? `<rect width="${width}" height="${height}" fill="${palette.paper}"/><path d="M0 ${height * .72} Q ${width * .28} ${height * .61} ${width * .56} ${height * .77} T ${width} ${height * .65} V ${height} H0Z" fill="${palette.primary}" opacity=".18"/>`
      : `<defs><linearGradient id="bg-${ns}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${palette.ink}"/><stop offset="100%" stop-color="${palette.primary}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#bg-${ns})"/>`;
  
  const headlineSize = isLandscape ? width * .085 : isStory ? width * .12 : width * .13;
  const textX = isLandscape ? width * .57 : width * .09;
  const textY = isLandscape ? height * .35 : isStory ? height * .59 : height * .62;
  const playerLine = project.position;
  const achievementLine = '';
  
  const headlineStr = escapeXml(project.headline);
  const playerText = escapeXml((project.playerName || 'YOUR PLAYER').toUpperCase());
  const jersey = escapeXml(project.jerseyNumber || '00');
  const team = escapeXml(project.teamName || 'YOUR TEAM');
  const position = escapeXml(playerLine || 'GAME DAY');
  const achievement = escapeXml(achievementLine);
  const message = '';
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
  
  const photoClip = `<clipPath id="photoClip-${ns}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}"/></clipPath>`;
  
  const placeholder = !project.mediaType && !project.photo
    ? `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="${palette.ink}" opacity=".16"/><circle cx="${frame.x + frame.width / 2}" cy="${frame.y + frame.height * .42}" r="${Math.min(frame.width, frame.height) * .12}" fill="${palette.paper}" opacity=".7"/><path d="M ${frame.x + frame.width * .26} ${frame.y + frame.height * .88} Q ${frame.x + frame.width / 2} ${frame.y + frame.height * .52} ${frame.x + frame.width * .74} ${frame.y + frame.height * .88}" fill="${palette.paper}" opacity=".7"/><text x="${frame.x + frame.width / 2}" y="${frame.y + frame.height * .96}" text-anchor="middle" font-size="${Math.max(18, width * .018)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${palette.paper}" opacity=".9">ADD PLAYER MEDIA</text>`
    : '';
  const bgContent = `${background}${geometric}${overlay}${placeholder}`;
  const photoMarkup = `<g clip-path="url(#photoClip-${ns})">${photo}</g><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="none" stroke="${palette.paper}" stroke-opacity=".32" stroke-width="${Math.max(2, width * .004)}"/>`;
  const textMarkup = `<text x="${textX}" y="${textY - headlineSize * .82}" font-size="${Math.max(16, width * .018)}" letter-spacing="${Math.max(2, width * .008)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".8">${playerText || 'PLAYER SPOTLIGHT'}</text><text x="${textX}" y="${textY}" font-size="${headlineSize}" font-family="Space Grotesk, sans-serif" font-weight="700" letter-spacing="${-headlineSize * .06}" fill="${textColor}">${headlineStr}</text><text x="${textX}" y="${textY + headlineSize * .34}" font-size="${Math.max(22, width * .032)}" font-family="Space Grotesk, sans-serif" font-weight="700" fill="${palette.accent}">#${jersey}</text><text x="${textX + Math.max(72, width * .075)}" y="${textY + headlineSize * .34}" font-size="${Math.max(18, width * .022)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".9">${team}</text><text x="${textX}" y="${textY + headlineSize * .65}" font-size="${Math.max(16, width * .018)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".72">${position}</text><text x="${textX}" y="${height - (isLandscape ? 100 : 115)}" font-size="${Math.max(16, width * .018)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".82">${achievement}</text><text x="${textX}" y="${height - (isLandscape ? 64 : 72)}" font-size="${Math.max(15, width * .016)}" font-family="DM Sans, sans-serif" font-weight="500" fill="${secondaryText}" opacity=".62">${message}</text>`;
  const branding = project.branding
    ? `<text x="${width - 55}" y="${height - 36}" text-anchor="end" font-size="${Math.max(12, width * .012)}" letter-spacing="${Math.max(1, width * .004)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".55">PIXL SPORTS STUDIO</text>`
    : '';

  const fgContent = `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="none" stroke="${palette.paper}" stroke-opacity=".32" stroke-width="${Math.max(2, width * .004)}"/>${textMarkup}${logo}${branding}<rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="34" fill="none" stroke="${palette.paper}" stroke-opacity=".18" stroke-width="${Math.max(2, width * .003)}"/><text x="${isLandscape ? width * .57 : width * .09}" y="${isLandscape ? 76 : 64}" font-size="${Math.max(15, width * .014)}" letter-spacing="${Math.max(2, width * .007)}" font-family="DM Sans, sans-serif" font-weight="700" fill="${secondaryText}" opacity=".7">${escapeXml(template.name.toUpperCase())}</text>`;

  if (layer === 'bg') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${photoClip}</defs>${bgContent}</svg>`;
  if (layer === 'fg') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${photoClip}</defs>${fgContent}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${photoClip}</defs>${bgContent}${photoMarkup}${fgContent}</svg>`;
}

export function getPhotoClipInfo(project: HypeCardProject, ns: string) {
  const { width, height } = getDimensions(project.format);
  if (project.format !== 'card') {
    const frame = getPhotoFrame(project.format);
    const x = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
    const y = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
    const w = frame.width * project.photoTransform.zoom;
    const h = frame.height * project.photoTransform.zoom;
    return {
      clipId: `photoClip-${ns}`,
      clipContent: `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}"/>`,
      x,
      y,
      w,
      h,
      cx: x + w / 2,
      cy: y + h / 2
    };
  }

  const frame = STADIUM_MEDIA_FRAME;
  const x = frame.x + (frame.width - frame.width * project.photoTransform.zoom) / 2 + project.photoTransform.x;
  const y = frame.y + (frame.height - frame.height * project.photoTransform.zoom) / 2 + project.photoTransform.y;
  const w = frame.width * project.photoTransform.zoom;
  const h = frame.height * project.photoTransform.zoom;
  return {
    clipId: `stadiumPhotoClip-${ns}`,
    clipContent: `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}"/>`,
    x,
    y,
    w,
    h,
    cx: x + w / 2,
    cy: y + h / 2,
  };
}
