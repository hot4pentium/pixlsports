export const HYPE_CARD_TEMPLATE_IDS = [
  'velocity',
  'wave',
  'glass',
  'varsity',
  'spotlight',
  'pixel-edge',
] as const;

export type HypeCardTemplateId = typeof HYPE_CARD_TEMPLATE_IDS[number];
export type HypeCardTemplateLayer = 'all' | 'bg' | 'fg';

export const HYPE_CARD_TEMPLATES: Array<{
  id: HypeCardTemplateId;
  name: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  framePrimary: string;
  frameSecondary?: string;
  lowerPrimary: string;
  lowerSecondary?: string;
  textColor: 'light' | 'dark' | 'primary';
  cornerStyle: 'rounded' | 'cut';
}> = [
  {
    id: 'velocity',
    name: 'Velocity',
    description: 'Sharp lines and fast cyan accents.',
    primaryColor: '#087DFF',
    secondaryColor: '#00D9F5',
    framePrimary: '#087DFF',
    frameSecondary: '#00D9F5',
    lowerPrimary: '#FFFFFE',
    lowerSecondary: '#00D9F5',
    textColor: 'light',
    cornerStyle: 'cut',
  },
  {
    id: 'wave',
    name: 'Wave',
    description: 'Flowing color bands with a rounded edge.',
    primaryColor: '#087DFF',
    secondaryColor: '#00D9F5',
    framePrimary: '#087DFF',
    lowerPrimary: '#087DFF',
    lowerSecondary: '#00D9F5',
    textColor: 'light',
    cornerStyle: 'rounded',
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'A light glass identity panel and double border.',
    primaryColor: '#B5C6D5',
    secondaryColor: '#087DFF',
    framePrimary: '#B5C6D5',
    lowerPrimary: '#FFFFFE',
    lowerSecondary: '#087DFF',
    textColor: 'dark',
    cornerStyle: 'rounded',
  },
  {
    id: 'varsity',
    name: 'Varsity',
    description: 'Cream pinstripes and a classic jersey-number badge.',
    primaryColor: '#F4E9CC',
    secondaryColor: '#F4E9CC',
    framePrimary: '#F4E9CC',
    lowerPrimary: '#FFFFFE',
    lowerSecondary: '#F4E9CC',
    textColor: 'light',
    cornerStyle: 'cut',
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    description: 'A dark stadium fade with a gold frame.',
    primaryColor: '#D8B35A',
    secondaryColor: '#D8B35A',
    framePrimary: '#D8B35A',
    lowerPrimary: '#FFFFFE',
    textColor: 'primary',
    cornerStyle: 'rounded',
  },
  {
    id: 'pixel-edge',
    name: 'Pixel Edge',
    description: 'Stepped pixels with bright lime contrast.',
    primaryColor: '#087DFF',
    secondaryColor: '#BAF500',
    framePrimary: '#087DFF',
    lowerPrimary: '#087DFF',
    lowerSecondary: '#BAF500',
    textColor: 'light',
    cornerStyle: 'cut',
  },
];

export const HYPE_CARD_SELECTABLE_TEMPLATES = HYPE_CARD_TEMPLATES.filter((template) => template.id !== 'pixel-edge');

const FRAME_LAYERS: Record<HypeCardTemplateId, string> = {
  velocity: `<path d="M34 7H866L893 34V1166L866 1193H34L7 1166V34Z" fill="none" stroke="#087DFF" stroke-width="12"/><path d="M12 34L34 12H205L130 87H12Z" fill="#061A38"/><path d="M160 12H205L130 87H85Z" fill="#00D9F5"/><path d="M688 1188H744L786 1146H730Z" fill="#00D9F5"/>`,
  wave: `<rect x="7" y="7" width="886" height="1186" rx="42" fill="none" stroke="#087DFF" stroke-width="12"/>`,
  glass: `<rect x="7" y="7" width="886" height="1186" rx="36" fill="none" stroke="#B5C6D5" stroke-width="12"/><rect x="24" y="24" width="852" height="1152" rx="27" fill="none" stroke="#FFFFFF" stroke-width="4"/>`,
  varsity: `<path d="M34 7H866L893 34V1166L866 1193H34L7 1166V34Z" fill="none" stroke="#F4E9CC" stroke-width="8"/><path d="M50 26H850L874 50V1150L850 1174H50L26 1150V50Z" fill="none" stroke="#061A38" stroke-width="13"/><path d="M56 39H844L861 56V1144L844 1161H56L39 1144V56Z" fill="none" stroke="#F4E9CC" stroke-width="5"/>`,
  spotlight: `<rect x="7" y="7" width="886" height="1186" rx="38" fill="none" stroke="#080B12" stroke-width="12"/><rect x="20" y="20" width="860" height="1160" rx="28" fill="none" stroke="#D8B35A" stroke-width="4"/>`,
  'pixel-edge': `<path d="M34 7H866L893 34V1166L866 1193H34L7 1166V34Z" fill="none" stroke="#061A38" stroke-width="18"/><rect x="18" y="18" width="25" height="25" fill="#087DFF"/><rect x="49" y="18" width="25" height="25" fill="#BAF500"/><rect x="18" y="49" width="25" height="25" fill="#BAF500"/><rect x="80" y="18" width="25" height="25" fill="#087DFF"/><rect x="49" y="49" width="25" height="25" fill="#087DFF"/><rect x="18" y="80" width="25" height="25" fill="#087DFF"/><rect x="846" y="1128" width="27" height="27" fill="#087DFF"/><rect x="815" y="1159" width="27" height="27" fill="#087DFF"/><rect x="846" y="1159" width="27" height="27" fill="#BAF500"/>`,
};

const LOWER_THIRD_LAYERS: Record<HypeCardTemplateId, string> = {
  velocity: `<path d="M0 1006L45 965H730L900 875V1200H0Z" fill="#061A38"/><path d="M0 1006L45 965H730L900 875V890L734 980H51L0 1027Z" fill="#00D9F5"/>`,
  wave: `<path d="M0 936C245 936 338 1075 900 937V1200H0Z" fill="#087DFF"/><path d="M0 956C269 947 405 1088 900 958V1200H0Z" fill="#00D9F5"/><path d="M0 975C275 965 444 1092 900 980V1200H0Z" fill="#061A38"/>`,
  glass: `<defs><linearGradient id="glass" x2="0" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".90"/><stop offset="1" stop-color="#E4E9EC" stop-opacity=".78"/></linearGradient></defs><rect x="12" y="963" width="876" height="225" rx="30" fill="url(#glass)" stroke="#FFFFFF" stroke-width="3"/><rect x="62" y="995" width="108" height="8" fill="#087DFF"/>`,
  varsity: `<rect x="0" y="969" width="900" height="231" fill="#061A38"/><rect x="0" y="962" width="900" height="7" fill="#F4E9CC"/><path d="M715 1012H815L846 1043V1147L815 1174H715L691 1150V1036Z" fill="none" stroke="#F4E9CC" stroke-width="4"/>`,
  spotlight: `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#030508" stop-opacity="0"/><stop offset=".65" stop-color="#030508" stop-opacity=".85"/><stop offset="1" stop-color="#030508"/></linearGradient></defs><rect x="0" y="810" width="900" height="390" fill="url(#shade)"/>`,
  'pixel-edge': `<path d="M0 946H217L242 970H593L621 995H780V967H820V938H900V1200H0Z" fill="#087DFF"/><path d="M0 946H217L242 970H593L621 995H780V967H820V938H900V959H839V988H800V1016H613L585 991H233L208 967H0Z" fill="#BAF500"/><path d="M0 1055H900V1200H0Z" fill="#061A38"/>`,
};

export type HypeCardTemplateArtworkInput = {
  frameTemplate: HypeCardTemplateId;
  lowerThirdTemplate: HypeCardTemplateId;
  athleteName: string;
  teamName?: string | null;
  jerseyNumber?: string | null;
  position?: string | null;
  photoUrl?: string | null;
  athleteX?: number;
  athleteY?: number;
  athleteScale?: number;
  borderColor?: string;
  accentColor?: string;
  brandLogoUrl?: string | null;
};

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] as string));
const safeUrl = (value?: string | null) => {
  const url = (value ?? '').trim();
  return /^(data:image\/(png|jpe?g|webp|gif|svg\+xml);|https?:\/\/|blob:|\/)/i.test(url) ? esc(url) : '';
};
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const num = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value! : fallback));
const templateById = (id: HypeCardTemplateId) => HYPE_CARD_TEMPLATES.find((item) => item.id === id) ?? HYPE_CARD_TEMPLATES[0];

function recolorLayer(markup: string, template: (typeof HYPE_CARD_TEMPLATES)[number], borderColor: string, accentColor: string) {
  return markup
    .replaceAll(template.framePrimary, borderColor)
    .replaceAll(template.lowerPrimary, borderColor)
    .replaceAll(template.frameSecondary ?? '\u0000', accentColor)
    .replaceAll(template.lowerSecondary ?? '\u0000', accentColor);
}

function textFit(text: string, maxSize: number, maxWidth: number) {
  const normalized = text.trim().replace(/\s+/g, ' ').toUpperCase();
  const size = Math.max(8, Math.min(maxSize, maxWidth / Math.max(1, normalized.length * .82)));
  const textLength = normalized.length * size * .82 > maxWidth
    ? `textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : '';
  return { text: normalized, size, textLength };
}

function fitName(text: string, maxSize: number, maxWidth: number) {
  const normalized = text.trim().replace(/\s+/g, ' ').toUpperCase();
  const singleLine = textFit(normalized, maxSize, maxWidth);
  if (singleLine.size >= 27 || normalized.length < 2) {
    return { lines: [singleLine.text], size: singleLine.size, textLength: singleLine.textLength };
  }

  const words = normalized.split(' ');
  let lines: string[];
  if (words.length > 1) {
    let bestSplit = 1;
    let bestWidth = Infinity;
    for (let split = 1; split < words.length; split++) {
      const left = words.slice(0, split).join(' ');
      const right = words.slice(split).join(' ');
      const width = Math.max(left.length, right.length);
      if (width < bestWidth) {
        bestSplit = split;
        bestWidth = width;
      }
    }
    lines = [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
  } else {
    const midpoint = Math.ceil(normalized.length / 2);
    lines = [normalized.slice(0, midpoint), normalized.slice(midpoint)];
  }

  const fitted = lines.map((line) => textFit(line, maxSize, maxWidth));
  return {
    lines: fitted.map((line) => line.text),
    size: Math.min(...fitted.map((line) => line.size)),
    textLength: fitted.some((line) => line.textLength)
      ? `textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
      : '',
  };
}

export function isHypeCardTemplate(value: unknown): value is HypeCardTemplateId {
  return typeof value === 'string' && (HYPE_CARD_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function buildHypeCardTemplateArtwork(
  input: HypeCardTemplateArtworkInput,
  layer: HypeCardTemplateLayer = 'all',
  ns = 'hype-template',
): string {
  const frameTemplate = templateById(input.frameTemplate);
  const lowerThirdTemplate = templateById(input.lowerThirdTemplate);
  const prefix = ns.replace(/[^A-Za-z0-9_-]/g, '') || 'hype-template';
  const borderColor = isColor(input.borderColor) ? input.borderColor.toUpperCase() : frameTemplate.primaryColor;
  const accentColor = isColor(input.accentColor) ? input.accentColor.toUpperCase() : frameTemplate.secondaryColor;
  const clipId = `${prefix}-photo-clip`;
  const cardClipId = `${prefix}-card-clip`;
  const lowerThirdClipId = `${prefix}-lower-third-safe-clip`;
  const cx = Math.round(num(input.athleteX, 0, -.25, .25) * 900);
  const cy = Math.round(num(input.athleteY, 0, -.18, .18) * 1200);
  const scale = num(input.athleteScale, 1, 1, 1.6);
  const imageX = (900 - 900 * scale) / 2;
  const imageY = (1200 - 1200 * scale) / 2;
  const photoUrl = safeUrl(input.photoUrl);
  const brandLogoUrl = safeUrl(input.brandLogoUrl);
  const athleteName = (input.athleteName || 'Athlete').trim().replace(/\s+/g, ' ');
  const fittedName = fitName(athleteName, 39, 590);
  const fittedPosition = textFit(input.position ?? '', 22, 590);
  const number = (input.jerseyNumber ?? '').replace(/^#/, '').trim().slice(0, 12);
  const photo = photoUrl
    ? `<g clip-path="url(#${clipId})"><g transform="translate(${cx} ${cy})" data-photo-placement="true"><image href="${photoUrl}" x="${imageX.toFixed(2)}" y="${imageY.toFixed(2)}" width="${(900 * scale).toFixed(2)}" height="${(1200 * scale).toFixed(2)}" preserveAspectRatio="xMidYMid slice" data-testid="svg-card-photo"/></g></g>`
    : `<g clip-path="url(#${clipId})"><rect width="900" height="1200" fill="url(#${prefix}-placeholder)"/><circle cx="450" cy="460" r="155" fill="#D7E8F7" opacity=".18"/><path d="M180 1120Q215 720 450 720T720 1120Z" fill="#D7E8F7" opacity=".18"/></g>`;
  const nameTextColor = lowerThirdTemplate.textColor === 'dark'
    ? '#061A38'
    : lowerThirdTemplate.textColor === 'primary'
      ? borderColor
      : '#FFFFFF';
  const nameText = fittedName.lines.map((line, index) => {
    const y = fittedName.lines.length === 1 ? 1080 : 1040 + index * 40;
    return `<text x="65" y="${y}" fill="${nameTextColor}" font-family="Barlow Condensed,Impact,'Arial Narrow',sans-serif" font-size="${fittedName.size.toFixed(2)}" font-weight="800" ${fittedName.textLength} data-athlete-name-line="true" data-testid="svg-card-athlete-name">${esc(line)}</text>`;
  }).join('');
  const brandLogo = brandLogoUrl
    ? `<g data-card-layer="pixl-brand"><rect x="34" y="110" width="160" height="68" rx="10" fill="#FFFFFF" fill-opacity=".94"/><image href="${brandLogoUrl}" x="43" y="116" width="142" height="56" preserveAspectRatio="xMidYMid meet" data-testid="svg-card-logo"/></g>`
    : '';
  const watermark = `<text x="820" y="600" transform="rotate(90 820 600)" text-anchor="middle" fill="#FFFFFF" stroke="#061A38" stroke-opacity=".36" stroke-width="2" paint-order="stroke" font-family="Barlow Condensed,Impact,'Arial Narrow',sans-serif" font-size="72" font-weight="800" letter-spacing="2" opacity=".5" data-testid="text-hype-card-watermark">HYPE Card</text>`;
  const text = layer === 'bg' ? '' : `${nameText}${fittedPosition.text ? `<text x="65" y="1127" fill="${nameTextColor}" font-family="DM Sans,Arial,sans-serif" font-size="${fittedPosition.size.toFixed(2)}" font-weight="700" ${fittedPosition.textLength} data-testid="svg-card-position">${esc(fittedPosition.text)}</text>` : ''}${number ? `<text x="768" y="1110" text-anchor="middle" fill="${nameTextColor}" font-family="Anton,Impact,'Arial Narrow',sans-serif" font-size="62" font-weight="400" data-testid="svg-card-jersey-number">${esc(number)}</text>` : ''}`;
  const lower = layer === 'bg' ? '' : recolorLayer(LOWER_THIRD_LAYERS[lowerThirdTemplate.id], lowerThirdTemplate, borderColor, accentColor)
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`);
  const frame = layer === 'bg' ? '' : recolorLayer(FRAME_LAYERS[frameTemplate.id], frameTemplate, borderColor, accentColor);
  const clipShape = frameTemplate.cornerStyle === 'rounded'
    ? '<rect x="0" y="0" width="900" height="1200" rx="54"/>'
    : '<path d="M36 0H864L900 36V1164L864 1200H36L0 1164V36Z"/>';
  const lowerThirdSafeClipShape = frameTemplate.cornerStyle === 'rounded'
    ? '<rect x="28" y="28" width="844" height="1144" rx="48"/>'
    : '<path d="M68 28H832L872 68V1132L832 1172H68L28 1132V68Z"/>';
  const defs = `<defs><clipPath id="${clipId}">${clipShape}</clipPath><clipPath id="${cardClipId}">${clipShape}</clipPath><clipPath id="${lowerThirdClipId}">${lowerThirdSafeClipShape}</clipPath><linearGradient id="${prefix}-placeholder" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#254A6F"/><stop offset="1" stop-color="#071A30"/></linearGradient></defs>`;
  const bg = layer === 'fg' ? '' : photo;
  const overlays = layer === 'bg' ? '' : `<g clip-path="url(#${cardClipId})"><g clip-path="url(#${lowerThirdClipId})">${lower}</g>${text}${watermark}${brandLogo}${frame}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="900" height="1200" viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(athleteName)} HYPE Card" data-frame-template="${frameTemplate.id}" data-lower-third-template="${lowerThirdTemplate.id}" data-layer="${layer}">${defs}${bg}${overlays}</svg>`;
}
