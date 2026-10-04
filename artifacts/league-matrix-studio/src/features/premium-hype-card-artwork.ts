import type { HypeCardAppearance } from './hype-card-appearance';

export type PremiumHypeCardInput = {
  athleteName: string;
  teamName?: string | null;
  sport?: string;
  jerseyNumber?: string;
  position?: string;
  photoUrl?: string | null;
  cutoutUrl?: string | null;
  appearance: HypeCardAppearance;
  logoUrl?: string;
};
export type PremiumHypeCardLayer = 'all' | 'bg' | 'fg';

const NAVY = '#10243D';
const IVORY = '#F6EFE2';
export const PREMIUM_FONT_DISPLAY = "'Barlow Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif";
export const PREMIUM_FONT_TEXT = "'DM Sans','Helvetica Neue',Arial,sans-serif";
const FONT_DISPLAY = PREMIUM_FONT_DISPLAY;
const FONT_TEXT = PREMIUM_FONT_TEXT;

export const escapeXml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const hex = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : fb);
const safeUrl = (v?: string | null) => {
  const s = (v || '').trim();
  return /^(data:image\/(png|jpe?g|webp|gif|svg\+xml);|https?:\/\/|blob:|\/)/i.test(s) ? escapeXml(s) : '';
};
const mix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
};
const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

type Venue = 'field' | 'diamond' | 'court' | 'ice' | 'pool';
function venueFor(sport?: string): Venue {
  const s = (sport || '').toLowerCase();
  if (/base|soft/.test(s)) return 'diamond';
  if (/basket|volley|gym|cheer|wrestl|hand|indoor|futsal/.test(s)) return 'court';
  if (/hockey|ice|skat/.test(s)) return 'ice';
  if (/swim|water|dive/.test(s)) return 'pool';
  return 'field';
}

/** Blurred venue drawn in rect (x,y,w,h). Daylight or night. Caller supplies unique id prefix. */
function venue(id: string, x: number, y: number, w: number, h: number, kind: Venue, night: boolean): string {
  const horizon = y + h * 0.66;
  const sky = night ? ['#0A1226', '#1A2447'] : ['#7FB6F0', '#CFE5F7'];
  const ground = kind === 'court' ? (night ? ['#3A2A22', '#150F10'] : ['#D9A867', '#B8814A'])
    : kind === 'ice' ? (night ? ['#47607E', '#14213A'] : ['#DCEAF4', '#B5CCDE'])
    : kind === 'pool' ? (night ? ['#17506A', '#0A1E34'] : ['#5CC3DC', '#2F95B6'])
    : (night ? ['#1E4A33', '#08170F'] : ['#8DBE5A', '#5E9A3A']);
  const indoor = kind === 'court' || kind === 'ice';
  const wall = indoor ? (night ? ['#141B33', '#241E3C'] : ['#E7DCC6', '#C9BB9F']) : sky;
  let deco = '';
  if (!indoor) {
    const tree = night ? '#0C1A1E' : '#3F6B3A';
    for (let i = 0; i < 9; i++) {
      const cx = x + (i + 0.5) * (w / 9) + ((i * 37) % 30) - 15;
      deco += `<ellipse cx="${cx}" cy="${horizon - 30}" rx="${70 + (i * 23) % 40}" ry="${90 + (i * 41) % 60}" fill="${tree}" opacity="${night ? 0.9 : 0.75}"/>`;
    }
    if (!night) deco += `<ellipse cx="${x + w * 0.25}" cy="${y + h * 0.16}" rx="170" ry="46" fill="#fff" opacity=".7"/><ellipse cx="${x + w * 0.72}" cy="${y + h * 0.26}" rx="210" ry="52" fill="#fff" opacity=".6"/>`;
    if (kind === 'diamond') deco += `<path d="M${x} ${horizon + 40} Q${x + w / 2} ${horizon - 40} ${x + w} ${horizon + 40} L${x + w} ${horizon + 130} L${x} ${horizon + 130}Z" fill="${night ? '#5A3A22' : '#C98F5A'}" opacity=".75"/>`;
    deco += `<g stroke="${night ? '#DCE6F5' : '#F4F6F8'}" stroke-width="7" fill="none" opacity=".65"><path d="M${x + w * 0.62} ${horizon + 6}V${horizon - 70}H${x + w * 0.9}V${horizon + 6}"/></g>`;
  } else {
    for (let i = 0; i < 6; i++) deco += `<rect x="${x + 30 + i * (w / 6)}" y="${y + h * 0.07}" width="${w / 6 - 60}" height="22" rx="11" fill="${night ? '#FFF6DC' : '#FFFFFF'}" opacity=".85"/>`;
    deco += `<rect x="${x}" y="${horizon - 90}" width="${w}" height="90" fill="${night ? '#0B1022' : '#9C8E78'}" opacity=".55"/>`;
  }
  const lines = `<g stroke="#fff" stroke-width="5" opacity="${night ? 0.25 : 0.4}" fill="none"><path d="M${x} ${horizon + 120}L${x + w} ${horizon + 80}"/><path d="M${x + w * 0.5} ${horizon}V${y + h}"/></g>`;
  return `<g id="${id}"><defs>
<linearGradient id="${id}-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${wall[0]}"/><stop offset="1" stop-color="${wall[1]}"/></linearGradient>
<linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ground[0]}"/><stop offset="1" stop-color="${ground[1]}"/></linearGradient>
<filter id="${id}-b" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${night ? 9 : 12}"/></filter></defs>
<g filter="url(#${id}-b)"><rect x="${x - 30}" y="${y - 30}" width="${w + 60}" height="${h + 60}" fill="url(#${id}-w)"/>${deco}
<rect x="${x - 30}" y="${horizon}" width="${w + 60}" height="${y + h - horizon + 30}" fill="url(#${id}-g)"/>${lines}</g></g>`;
}

function fitName(name: string, maxW: number, maxSize: number, minSize: number, twoLineMax = maxSize * 0.8) {
  const text = name.trim().toUpperCase();
  const est = (s: number, n: number) => n * s * 0.46;
  let size = Math.min(maxSize, maxW / Math.max(1, est(1, text.length)));
  if (size >= minSize || !text.includes(' ')) {
    size = Math.max(minSize * 0.6, size);
    return { lines: [text], size, tl: est(size, text.length) > maxW ? maxW : 0 };
  }
  const words = text.split(/\s+/);
  let best = 1, diff = 1e9;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < diff) { diff = d; best = i; }
  }
  const lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  const longest = Math.max(lines[0].length, lines[1].length);
  size = Math.max(minSize * 0.6, Math.min(twoLineMax, maxW / est(1, longest)));
  return { lines, size, tl: 0 };
}

const nameText = (lines: string[], x: number, y: number, size: number, tl: number, fill: string, anchor = 'start') =>
  lines.map((l, i) => `<text x="${x}" y="${y + i * size * 0.98}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${size.toFixed(1)}" fill="${fill}" text-anchor="${anchor}" letter-spacing="1"${tl ? ` textLength="${tl}" lengthAdjust="spacingAndGlyphs"` : ''}>${escapeXml(l)}</text>`).join('');

const grainDef = (id: string, op: number) => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .3  0 0 0 0 .25  0 0 0 ${op} 0"/></filter>`;

function athlete(input: PremiumHypeCardInput, box: { x: number; y: number; w: number; h: number }, shadow: string): string {
  const url = safeUrl(input.cutoutUrl);
  if (!url || input.appearance.removeBackground === false) return '';
  const a = input.appearance;
  const cx = box.x + box.w / 2, by = box.y + box.h;
  const s = Math.max(0.65, Math.min(1.45, num(a.athleteScale, 1)));
  const tx = Math.max(-.25, Math.min(.25, num(a.athleteX, 0))) * 1000;
  const ty = Math.max(-.18, Math.min(.18, num(a.athleteY, 0))) * 1400;
  return `<g data-photo-placement="cutout" transform="translate(${cx + tx} ${by + ty}) scale(${s}) translate(${-cx} ${-by})">
<image href="${url}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMax meet" filter="url(#${shadow})"/></g>`;
}
const initialsOf = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || 'P';
const initialsArt = (input: PremiumHypeCardInput, cx: number, cy: number, fill: string) =>
  (input.appearance.removeBackground !== false && safeUrl(input.cutoutUrl)) || safeUrl(input.photoUrl) ? '' : `<g aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="170" fill="${fill}" opacity=".35"/><text x="${cx}" y="${cy + 55}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-weight="700" font-size="170" fill="#fff" opacity=".9">${escapeXml(initialsOf(input.athleteName))}</text></g>`;
const photoFallback = (input: PremiumHypeCardInput, box: { x: number; y: number; w: number; h: number }, clip: string, opacity = 1) => {
  const url = safeUrl(input.photoUrl);
  if (!url || (input.appearance.removeBackground !== false && safeUrl(input.cutoutUrl))) return '';
  const a = input.appearance;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const scale = Math.max(.65, Math.min(1.45, num(a.athleteScale, 1)));
  const x = Math.max(-.25, Math.min(.25, num(a.athleteX, 0))) * 1000;
  const y = Math.max(-.18, Math.min(.18, num(a.athleteY, 0))) * 1400;
  return `<g clip-path="url(#${clip})" opacity="${opacity}"><g data-photo-placement="original" transform="translate(${cx + x} ${cy + y}) scale(${scale}) translate(${-cx} ${-cy})"><image href="${url}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid slice"/></g></g>`;
};
const shadowFilter = (id: string, blur: number, dy: number, op: number) => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="#0A1020" flood-opacity="${op}"/></filter>`;

function logo(input: PremiumHypeCardInput, x: number, y: number, w: number) {
  const src = safeUrl(input.logoUrl);
  if (!src) return '';
  return `<image href="${src}" x="${x}" y="${y}" width="${w}" height="${(w * 550 / 1347).toFixed(1)}" preserveAspectRatio="xMinYMin meet"/>`;
}

function gallery(input: PremiumHypeCardInput, layer: PremiumHypeCardLayer): string {
  const a = input.appearance;
  const border = hex(a.borderColor, '#EF3996'), accent = hex(a.accentColor, border);
  const sport = escapeXml((input.sport || '').toUpperCase());
  const position = (input.position || a.position || '').trim();
  const jersey = (input.jerseyNumber || a.jerseyNumber || '').trim();
  const sub = [jersey ? `#${jersey}` : '', position].filter(Boolean).join('  |  ').toUpperCase();
  const team = (input.teamName || '').trim().toUpperCase();
  const win = { x: 90, y: 160, w: 820, h: 800 };
  const nm = fitName(input.athleteName || 'Athlete', 800, 190, 110, 100);
  const nameBase = nm.lines.length > 1 ? 1123 : 1205;
  const subY = nm.lines.length > 1 ? Math.min(1305, nameBase + nm.size * 0.98 + 52) : 1285;
  const bg = `
<defs>${grainDef('g-grain', 0.16)}${shadowFilter('g-shadow', 4, 3, .22)}
<filter id="g-card-shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#2B2118" flood-opacity=".28"/></filter>
<filter id="g-soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="2" dy="5" stdDeviation="5" flood-color="#2B2118" flood-opacity=".3"/></filter>
<filter id="g-emb-l"><feOffset dx="-2" dy="-2"/></filter>
<linearGradient id="g-ivory" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBF6EB"/><stop offset="1" stop-color="#EFE6D4"/></linearGradient>
<linearGradient id="g-inner" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2118" stop-opacity=".38"/><stop offset=".07" stop-color="#2B2118" stop-opacity="0"/><stop offset=".93" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".25"/></linearGradient>
<clipPath id="g-win"><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="40"/></clipPath>
<clipPath id="g-shell"><rect x="30" y="30" width="940" height="1340" rx="58"/></clipPath>
<symbol id="g-swirl" viewBox="-200 -200 400 400"><g fill="none" stroke-linecap="round" stroke-width="5"><path d="M0-190C110-190 190-110 190 0S110 190 0 190-150 120-150 0-90-120 0-120 110-70 110 0 60 80 0 80-50 40-50 0"/><path d="M-170-60C-120-170 40-210 140-130"/><path d="M180 70C130 170-10 200-110 150"/></g></symbol></defs>
<g id="gallery-bg">
<rect x="30" y="30" width="940" height="1340" rx="58" fill="url(#g-ivory)" filter="url(#g-card-shadow)"/>
<rect x="30" y="30" width="940" height="1340" rx="58" filter="url(#g-grain)" opacity=".7"/>
<rect x="33" y="33" width="934" height="1334" rx="55" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="3"/>
<g clip-path="url(#g-shell)" opacity=".26"><use href="#g-swirl" x="590" y="-30" width="420" height="420" style="color:#fff" stroke="#fff"/><use href="#g-swirl" x="600" y="-20" width="420" height="420" stroke="#B9AB92" transform="translate(0 0)"/></g>
<g clip-path="url(#g-shell)" opacity=".24"><use href="#g-swirl" x="600" y="1000" width="420" height="420" stroke="#fff"/><use href="#g-swirl" x="610" y="1010" width="420" height="420" stroke="#B9AB92"/></g>
<g filter="url(#g-soft)"><rect x="62" y="132" width="140" height="150" rx="22" fill="${accent}" transform="rotate(-6 132 207)"/><rect x="62" y="132" width="140" height="150" rx="22" filter="url(#g-grain)" transform="rotate(-6 132 207)"/>
<rect x="838" y="780" width="110" height="190" rx="22" fill="${mix(accent, '#FFFFFF', .08)}" transform="rotate(3 893 875)"/><rect x="838" y="780" width="110" height="190" rx="22" filter="url(#g-grain)" transform="rotate(3 893 875)"/></g>
<rect x="${win.x - 18}" y="${win.y - 18}" width="${win.w + 36}" height="${win.h + 36}" rx="56" fill="#F8F1E3" stroke="${border}" stroke-opacity=".7" stroke-width="3" filter="url(#g-soft)"/>
<g clip-path="url(#g-win)">${venue('g-venue', win.x, win.y, win.w, win.h, venueFor(input.sport), false)}
${photoFallback(input, win, 'g-win')}${initialsArt(input, 500, 600, NAVY)}
<rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" fill="url(#g-inner)"/></g>
<rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="40" fill="none" stroke="#2B2118" stroke-opacity=".25" stroke-width="3"/>
</g>`;
  const fg = `
<defs>${grainDef('g-grain2', 0.0)}${shadowFilter('g-cut', 14, 10, .38)}</defs>
<g id="gallery-fg">
<rect x="30" y="30" width="940" height="1340" rx="58" fill="none" stroke="${border}" stroke-width="5"/>
${logo(input, 88, 74, 170)}
<line x1="90" y1="1327" x2="910" y2="1327" stroke="${NAVY}" stroke-opacity=".14" stroke-width="2"/>
${sport ? `<line x1="722" y1="104" x2="758" y2="104" stroke="${accent}" stroke-width="4"/><text x="912" y="115" text-anchor="end" font-family="${FONT_TEXT}" font-weight="600" font-size="28" letter-spacing="6" fill="${NAVY}">${sport}</text>` : ''}
${athlete(input, { x: 120, y: 60, w: 760, h: 900 }, 'g-cut')}
${team ? (team.length <= 18 ? `<g transform="translate(62 ${win.y + 330}) rotate(-90)"><text x="0" y="0" text-anchor="middle" font-family="${FONT_TEXT}" font-weight="600" font-size="22" letter-spacing="5" fill="${NAVY}">${escapeXml(team)}</text></g>` : `<text x="90" y="1063" font-family="${FONT_TEXT}" font-weight="600" font-size="22" letter-spacing="5" fill="${NAVY}">${escapeXml(team)}</text>`) : ''}
${nameText(nm.lines, 500, nameBase + (nm.lines.length > 1 ? 0 : 0), nm.size, nm.tl, NAVY, 'middle').replace(/<text x="500"/g, '<text x="500"')}
${sub ? `<line x1="90" y1="${subY - 10}" x2="${500 - Math.min(300, sub.length * 11 + 20)}" y2="${subY - 10}" stroke="${accent}" stroke-width="3"/><line x1="${500 + Math.min(300, sub.length * 11 + 20)}" y1="${subY - 10}" x2="910" y2="${subY - 10}" stroke="${accent}" stroke-width="3"/><text x="500" y="${subY}" text-anchor="middle" font-family="${FONT_TEXT}" font-weight="600" font-size="30" letter-spacing="8" fill="${NAVY}">${escapeXml(sub)}</text>` : ''}
</g>`;
  return (layer !== 'fg' ? bg : '') + (layer !== 'bg' ? fg : '');
}

function spotlight(input: PremiumHypeCardInput, layer: PremiumHypeCardLayer): string {
  const a = input.appearance;
  const border = hex(a.borderColor, '#EF3996'), accent = hex(a.accentColor, border);
  const sport = escapeXml((input.sport || '').toUpperCase());
  const position = (input.position || a.position || '').trim().toUpperCase();
  const jersey = (input.jerseyNumber || a.jerseyNumber || '').trim().replace(/^#/, '');
  const team = (input.teamName || '').trim().toUpperCase();
  const card = { x: 14, y: 14, w: 972, h: 1372 };
  const nm = fitName(input.athleteName || 'Athlete', 760, 170, 100, 120);
  const plateH = Math.max(235, 34 + nm.size * 0.9 + (nm.lines.length - 1) * nm.size * 0.98 + 52 + 44);
  const plate = { x: 70, y: 1350 - plateH, w: 860, h: plateH };
  const nameY = plate.y + 30 + nm.size * 0.9;
  const detailY = nameY + (nm.lines.length - 1) * nm.size * 0.98 + 50;
  const splitX = 640;
  const numSize = jersey.length > 2 ? 520 : jersey.length === 2 ? 760 : 900;
  const bg = `
<defs>${grainDef('s-grain', 0.2)}
<clipPath id="s-card"><rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="50"/></clipPath>
<filter id="s-haze" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="55"/></filter>
<filter id="s-numtex" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".035 .06" numOctaves="3" seed="3" result="n"/><feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.7" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
<radialGradient id="s-vig" cx=".5" cy=".42" r=".75"><stop offset=".5" stop-color="#050913" stop-opacity="0"/><stop offset="1" stop-color="#050913" stop-opacity=".85"/></radialGradient>
<linearGradient id="s-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050913" stop-opacity="0"/><stop offset="1" stop-color="#050913" stop-opacity=".85"/></linearGradient></defs>
<g id="spotlight-bg"><g clip-path="url(#s-card)">
<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" fill="#08101F"/>
${venue('s-venue', card.x, card.y, card.w, card.h, venueFor(input.sport), true)}
${photoFallback(input, { x: card.x, y: card.y, w: card.w, h: card.h }, 's-card', 0.55)}${initialsArt(input, 500, 700, accent)}
<circle cx="150" cy="520" r="230" fill="#FFF3D6" opacity=".35" filter="url(#s-haze)"/>
<circle cx="850" cy="520" r="230" fill="#FFF3D6" opacity=".35" filter="url(#s-haze)"/>
<g id="s-lights">${[[110, 470], [890, 470]].map(([x, y]) => `<g fill="#FFFBEA"><rect x="${x - 58}" y="${y - 50}" width="116" height="100" rx="10" opacity=".95"/></g><g fill="#2B3350">${[0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => `<circle cx="${x - 39 + c * 26}" cy="${y - 30 + r * 30}" r="8" fill="#FFFFFF"/>`)).join('')}</g><rect x="${x - 4}" y="${y + 50}" width="8" height="260" fill="#0A1022" opacity=".8"/>`).join('')}</g>
<ellipse cx="500" cy="760" rx="520" ry="420" fill="${accent}" opacity=".32" filter="url(#s-haze)"/>
<ellipse cx="500" cy="300" rx="380" ry="220" fill="${accent}" opacity=".18" filter="url(#s-haze)"/>
${jersey ? `<g filter="url(#s-numtex)"><text x="500" y="${numSize === 900 ? 780 : 740}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${numSize}" fill="${mix(accent, '#0A1226', .45)}" opacity=".85" textLength="${Math.min(820, jersey.length * numSize * 0.55)}" lengthAdjust="spacingAndGlyphs">${escapeXml(jersey)}</text></g>` : ''}
<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" fill="url(#s-vig)"/>
<rect x="${card.x}" y="900" width="${card.w}" height="${card.h - 900}" fill="url(#s-floor)"/>
<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" filter="url(#s-grain)" opacity=".5"/>
</g></g>`;
  const fg = `
<defs>${shadowFilter('s-cut', 16, 10, .55)}
<filter id="s-glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="s-plate" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#02050C" flood-opacity=".6"/></filter>
<linearGradient id="s-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset=".56" stop-color="#C9BFA9" stop-opacity=".25"/><stop offset=".8" stop-color="#C9BFA9" stop-opacity=".25"/><stop offset=".81" stop-color="#fff" stop-opacity="0"/></linearGradient>
${grainDef('s-grain2', 0.14)}</defs>
<g id="spotlight-fg">
<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="50" fill="none" stroke="${border}" stroke-width="10" opacity=".55" filter="url(#s-glow)"/>
<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="50" fill="none" stroke="${border}" stroke-width="5"/>
${input.logoUrl ? `<rect x="76" y="62" width="196" height="76" rx="14" fill="${IVORY}" opacity=".94"/>` : ''}${logo(input, 88, 70, 172)}
<line x1="86" y1="152" x2="140" y2="152" stroke="${accent}" stroke-width="4"/>
${sport ? `<text x="912" y="108" text-anchor="end" font-family="${FONT_TEXT}" font-weight="600" font-size="28" letter-spacing="8" fill="#F1ECE2">${sport}</text><line x1="860" y1="152" x2="914" y2="152" stroke="${accent}" stroke-width="4"/>` : ''}
${athlete(input, { x: 90, y: 120, w: 820, h: 1130 }, 's-cut')}
<g filter="url(#s-plate)">
<rect x="${plate.x + 20}" y="${plate.y + 22}" width="${plate.w}" height="${plate.h}" rx="30" fill="${mix(accent, '#000000', .12)}" transform="rotate(-1.4 500 ${plate.y + plate.h / 2})"/>
<rect x="${plate.x + 5}" y="${plate.y - 14}" width="${plate.w}" height="${plate.h}" rx="30" fill="${accent}" transform="rotate(1.6 500 ${plate.y + plate.h / 2})"/>
<rect x="${plate.x}" y="${plate.y}" width="${plate.w}" height="${plate.h}" rx="28" fill="${IVORY}"/></g>
<rect x="${plate.x}" y="${plate.y}" width="${plate.w}" height="${plate.h}" rx="28" fill="url(#s-sheen)"/>
<rect x="${plate.x}" y="${plate.y}" width="${plate.w}" height="${plate.h}" rx="28" filter="url(#s-grain2)" opacity=".6"/>
${nameText(nm.lines, plate.x + 40, nameY, nm.size, nm.tl, NAVY)}
${team ? `<text x="${plate.x + 44}" y="${detailY}" font-family="${FONT_TEXT}" font-weight="700" font-size="30" letter-spacing="6" fill="${NAVY}">${escapeXml(team.slice(0, 26))}</text><line x1="${plate.x + 44}" y1="${detailY + 22}" x2="${plate.x + 134}" y2="${detailY + 22}" stroke="${accent}" stroke-width="4"/>` : ''}
${position ? (team ? `<line x1="${splitX - 20}" y1="${detailY - 32}" x2="${splitX - 20}" y2="${detailY + 12}" stroke="${NAVY}" stroke-opacity=".6" stroke-width="2"/>` : '') + `<text x="${plate.x + plate.w - 40}" y="${detailY}" text-anchor="end" font-family="${FONT_TEXT}" font-weight="700" font-size="26" letter-spacing="5" fill="${NAVY}">${escapeXml(position.slice(0, 22))}</text>` : ''}
</g>`;
  return (layer !== 'fg' ? bg : '') + (layer !== 'bg' ? fg : '');
}

function breakout(input: PremiumHypeCardInput, layer: PremiumHypeCardLayer): string {
  const a = input.appearance;
  const border = hex(a.borderColor, '#B7C4D4'), accent = hex(a.accentColor, '#26A9FF');
  const sport = (input.sport || '').trim().toUpperCase();
  const team = (input.teamName || '').trim().toUpperCase();
  const win = { x: 108, y: 150, w: 784, h: 820 };
  const nm = fitName(input.athleteName || 'Athlete', 760, 132, 96, 96);
  const nameY = nm.lines.length > 1 ? 988 : 1058;
  const bg = `
<defs>
<linearGradient id="b-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#69798D"/><stop offset=".13" stop-color="#F5F8FC"/><stop offset=".26" stop-color="#778598"/><stop offset=".48" stop-color="#DDE5EF"/><stop offset=".64" stop-color="#657588"/><stop offset=".82" stop-color="#F7FAFC"/><stop offset="1" stop-color="#68778A"/></linearGradient>
<linearGradient id="b-stage" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#101F39"/><stop offset=".54" stop-color="#172C49"/><stop offset=".83" stop-color="#364B62"/><stop offset="1" stop-color="#101C2E"/></linearGradient>
<linearGradient id="b-plate" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#192C4A"/><stop offset=".54" stop-color="#071329"/><stop offset="1" stop-color="#132C50"/></linearGradient>
<filter id="b-glow" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="20"/></filter>
<filter id="b-cut" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="14" stdDeviation="13" flood-color="#020711" flood-opacity=".72"/></filter>
<clipPath id="b-window"><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="56"/></clipPath>
<clipPath id="b-card"><rect x="18" y="18" width="964" height="1364" rx="62"/></clipPath>
<clipPath id="b-interior"><rect x="29" y="29" width="942" height="1342" rx="51"/></clipPath>
</defs>
<g id="breakout-bg" clip-path="url(#b-card)">
<g clip-path="url(#b-interior)">
<rect x="29" y="29" width="942" height="1342" rx="51" fill="url(#b-stage)"/>
<ellipse cx="500" cy="478" rx="470" ry="335" fill="${accent}" opacity=".17" filter="url(#b-glow)"/>
${venue('b-venue', win.x, win.y, win.w, win.h, venueFor(input.sport), true)}
</g>
<g data-card-layer="frame">
<g clip-path="url(#b-window)">${venue('b-window-venue', win.x, win.y, win.w, win.h, venueFor(input.sport), true)}</g>
${photoFallback(input, win, 'b-window')}
${initialsArt(input, 500, 560, accent)}
<rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="56" fill="#081528" fill-opacity=".13"/>
<g fill="#EAF6FF" filter="url(#b-glow)" opacity=".66"><ellipse cx="116" cy="382" rx="56" ry="30"/><ellipse cx="884" cy="382" rx="56" ry="30"/></g>
<rect x="24" y="24" width="952" height="1352" rx="56" fill="none" stroke="url(#b-metal)" stroke-width="10"/>
</g>
</g>`;
  const plate = `<g data-card-layer="name-plate" transform="translate(${(num(a.namePlateX, 0) * 1000).toFixed(1)} ${(num(a.namePlateY, 0) * 1400).toFixed(1)})" filter="url(#b-name-shadow)"><path d="M116 934H884L924 978V1128Q924 1160 892 1160H108Q76 1160 76 1128V978Z" fill="url(#b-plate)" stroke="url(#b-metal)" stroke-width="10" stroke-linejoin="round"/>
<path d="M156 956H844" stroke="#FFFFFF" stroke-opacity=".24" stroke-width="2"/>
${nameText(nm.lines, 500, nameY, nm.size, nm.tl, '#F7F9FC', 'middle')}
${team ? `<path d="M184 1114h95m442 0h95" stroke="${accent}" stroke-width="3"/><text x="500" y="1129" text-anchor="middle" font-family="${FONT_TEXT}" font-size="30" font-weight="700" letter-spacing="8" fill="#DFE8F4">${escapeXml(team.slice(0, 24))}</text>` : ''}</g>`;
  const fg = `<defs><linearGradient id="b-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#69798D"/><stop offset=".13" stop-color="#F5F8FC"/><stop offset=".26" stop-color="#778598"/><stop offset=".48" stop-color="#DDE5EF"/><stop offset=".64" stop-color="#657588"/><stop offset=".82" stop-color="#F7FAFC"/><stop offset="1" stop-color="#68778A"/></linearGradient><linearGradient id="b-plate" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#192C4A"/><stop offset=".54" stop-color="#071329"/><stop offset="1" stop-color="#132C50"/></linearGradient>${shadowFilter('b-cut', 14, 10, .42)}${shadowFilter('b-name-shadow', 8, 7, .6)}</defs>
<g id="breakout-fg">
<g data-card-layer="frame">${logo(input, 92, 62, 148)}${sport ? `<text x="872" y="112" text-anchor="end" font-family="${FONT_TEXT}" font-size="24" font-weight="800" letter-spacing="5" fill="#E8EEF8">${escapeXml(sport)}</text>` : ''}<path d="M88 1156H912" stroke="${accent}" stroke-width="4" opacity=".9"/></g>
<g data-card-layer="avatar">${athlete(input, { x: 115, y: -210, w: 770, h: 1020 }, 'b-cut')}</g>
${plate}
</g>`;
  return (layer !== 'fg' ? bg : '') + (layer !== 'bg' ? fg : '');
}

/** Prefix every id and reference so several SVGs can be mounted in one document. */
export function namespacePremiumSvg(svg: string, ns: string): string {
  const prefix = ns.replace(/[^A-Za-z0-9_-]/g, '');
  if (!prefix) return svg;
  const ids = new Set<string>();
  svg.replace(/\sid="([^"]+)"/g, (_m, id: string) => { ids.add(id); return ''; });
  return svg
    .replace(/\sid="([^"]+)"/g, (_m, id: string) => ` id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id: string) => ids.has(id) ? `url(#${prefix}-${id})` : m)
    .replace(/(href|xlink:href)="#([^"]+)"/g, (m, a: string, id: string) => ids.has(id) ? `${a}="#${prefix}-${id}"` : m);
}

export function buildPremiumHypeCardArtwork(input: PremiumHypeCardInput, layer: PremiumHypeCardLayer = 'all', ns?: string): string {
  const appearance = input.appearance;
  const design = appearance?.design === 'spotlight' ? 'spotlight' : appearance?.design === 'breakout' ? 'breakout' : 'gallery';
  const safe = { ...input, athleteName: input.athleteName || '' };
  const body = design === 'spotlight' ? spotlight(safe, layer) : design === 'breakout' ? breakout(safe, layer) : gallery(safe, layer);
  const out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 1400" width="1000" height="1400" overflow="visible" role="img" aria-label="${escapeXml(input.athleteName)} Hype Card" data-layer="${layer}" data-design="${design}">${body}</svg>`;
  return ns ? namespacePremiumSvg(out, ns) : out;
}

const NAV_ITEMS = ['REPLIES', 'STATS', 'TAPS', 'EVENTS'] as const;
const navIcon = (i: number, c: string) => [
  `<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`,
  `<path d="M5 21V12M12 21V4M19 21V9" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>`,
  `<path d="M13 2 3 14h9l-1 8 10-12h-9Z" fill="${c}"/>`,
  `<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="${c}" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="${c}" stroke-width="2"/>`,
][i];

/** Static Replies/Stats/Taps/Events strip for PNG export. The live card uses real HTML buttons. */
export function buildPremiumNavStripExport(appearance: HypeCardAppearance): string {
  const accent = hex(appearance.accentColor, '#EF3996');
  const gallery = appearance.design === 'gallery';
  const x = gallery ? 90 : 70, w = gallery ? 820 : 860, y = 1298, h = 56, cw = w / 4;
  const ink = gallery ? NAVY : '#E9EEF7';
  const cells = NAV_ITEMS.map((label, i) => {
    const cx = x + cw * i + cw / 2;
    return `<g transform="translate(${cx - 10} ${y + 7}) scale(.83)">${navIcon(i, gallery ? NAVY : accent)}</g>
<text x="${cx}" y="${y + 46}" text-anchor="middle" font-family="${FONT_TEXT}" font-weight="800" font-size="13" letter-spacing="2" fill="${ink}">${label}</text>
${i > 0 ? `<line x1="${x + cw * i}" y1="${y + 8}" x2="${x + cw * i}" y2="${y + h - 8}" stroke="${ink}" stroke-opacity=".22"/>` : ''}`;
  }).join('');
  const back = gallery
    ? `<rect x="${x}" y="${y - 3}" width="${w}" height="${h + 6}" rx="10" fill="#F6EFE2"/>`
    : `<rect x="${x}" y="${y - 3}" width="${w}" height="${h + 6}" rx="22" fill="#0B1A33" stroke="#fff" stroke-opacity=".18"/>`;
  return `<g id="export-nav">${back}${cells}</g>`;
}

/** Preview the saved card's navigation dressing as its own strip below the artwork. */
export function buildPremiumNavStripPreview(appearance: HypeCardAppearance, ns?: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 1294 1000 68" width="1000" height="68" aria-hidden="true" data-design="${appearance.design}">${buildPremiumNavStripExport(appearance)}</svg>`;
  return ns ? namespacePremiumSvg(svg, `${ns}-nav`) : svg;
}

/**
 * Prepare card-only PNG artwork. Premium avatars may intentionally extend above
 * their frame, so expand the raster viewport instead of relying on SVG overflow,
 * which raster exports clip at the viewBox.
 */
export function preparePremiumCardPngExport(
  artwork: string,
  appearance: HypeCardAppearance,
  cutoutSize?: { width: number; height: number },
): {
  markup: string;
  width: number;
  height: number;
} {
  let topBleed = 0;
  if (artwork.includes('data-photo-placement="cutout"')
    && cutoutSize && cutoutSize.width > 0 && cutoutSize.height > 0) {
    const scale = Math.max(0.65, Math.min(1.45, Number(appearance.athleteScale) || 1));
    const y = Math.max(-0.18, Math.min(0.18, Number(appearance.athleteY) || 0)) * 1400;
    const box = appearance.design === 'gallery'
      ? { x: 120, y: 60, width: 760, height: 900 }
      : appearance.design === 'spotlight'
        ? { x: 90, y: 120, width: 820, height: 1130 }
        : { x: 115, y: -210, width: 770, height: 1020 };
    const boxBottom = box.y + box.height;
    const imageScale = Math.min(box.width / cutoutSize.width, box.height / cutoutSize.height);
    const imageTop = boxBottom - cutoutSize.height * imageScale;
    const transformedTop = (imageTop - boxBottom) * scale + boxBottom + y;
    if (transformedTop < 0) topBleed = Math.ceil(-transformedTop + 32);
  }

  const viewHeight = 1400 + topBleed;
  let markup = artwork;
  if (topBleed) {
    if (!artwork.includes('viewBox="0 0 1000 1400"') || !artwork.includes('width="1000" height="1400"')) {
      throw new Error('Unexpected premium card artwork viewport.');
    }
    markup = artwork
      .replace('viewBox="0 0 1000 1400"', `viewBox="0 -${topBleed} 1000 ${viewHeight}"`)
      .replace('width="1000" height="1400"', `width="1000" height="${viewHeight}"`);
  }
  return { markup, width: 2000, height: viewHeight * 2 };
}
