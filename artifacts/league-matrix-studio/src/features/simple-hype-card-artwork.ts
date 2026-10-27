import { buildHypeCardTemplateArtwork, isHypeCardTemplate, type HypeCardTemplateId } from './hype-card-template-artwork';

export type LowerThirdStyle = 'classic' | 'split' | 'angled' | 'none';
export const lowerThirdStyles: Array<{ id: LowerThirdStyle; label: string }> = [
  { id: 'classic', label: 'Classic' }, { id: 'split', label: 'Split' }, { id: 'angled', label: 'Angled' },
  { id: 'none', label: 'Text only' },
];
export type SimpleCardInput = {
  athleteName: string; teamName?: string | null; jerseyNumber?: string | null;
  position?: string | null; photoUrl?: string | null; logoUrl?: string | null;
  brandLogoUrl?: string | null;
  lowerThirdStyle?: string | null; athleteX?: number; athleteY?: number;
  athleteScale?: number; design?: string; lowerThirdTemplate?: string;
  borderColor?: string; accentColor?: string;
};
export const SIMPLE_CARD_W = 600;
export const SIMPLE_CARD_H = 900;
export const HYPE_TEMPLATE_CARD_W = 900;
export const HYPE_TEMPLATE_CARD_H = 1200;
const LOWER_THIRD_HEIGHT = 180;
const LOWER_THIRD_TOP = SIMPLE_CARD_H - LOWER_THIRD_HEIGHT;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export function normalizeLowerThird(v: unknown): LowerThirdStyle {
  return v === 'split' || v === 'angled' || v === 'none' ? v : 'classic';
}
function fit(text: string, size: number, avail: number, family: string, weight = 900, extra = '') {
  const est = text.length * size * 0.47;
  return { size, attrs: `font-family="${family}" font-weight="${weight}" font-size="${size}" ${extra} ${est > avail ? `textLength="${avail}" lengthAdjust="spacingAndGlyphs"` : ''}` };
}
/** Pure SVG renderer shared by the live card and JPEG export. */
export function buildSimpleHypeCardArtwork(input: SimpleCardInput, ns = 'sc'): string {
  if (isHypeCardTemplate(input.design)) {
    const lowerThirdTemplate: HypeCardTemplateId = isHypeCardTemplate(input.lowerThirdTemplate)
      ? input.lowerThirdTemplate
      : input.design;
    return buildHypeCardTemplateArtwork({
      frameTemplate: input.design,
      lowerThirdTemplate,
      athleteName: input.athleteName,
      teamName: input.teamName,
      jerseyNumber: input.jerseyNumber,
      position: input.position,
      photoUrl: input.photoUrl,
      athleteX: input.athleteX,
      athleteY: input.athleteY,
      athleteScale: input.athleteScale,
      borderColor: input.borderColor,
      accentColor: input.accentColor,
      brandLogoUrl: input.brandLogoUrl,
    }, 'all', ns);
  }
  const style = normalizeLowerThird(input.lowerThirdStyle);
  const x = Math.max(-.25, Math.min(.25, input.athleteX ?? 0)) * SIMPLE_CARD_W;
  const photoHeight = SIMPLE_CARD_H;
  const y = Math.max(-.18, Math.min(.18, input.athleteY ?? 0)) * SIMPLE_CARD_H;
  const name = (input.athleteName || 'Athlete').toUpperCase();
  const team = (input.teamName ?? '').toUpperCase();
  const position = (input.position ?? '').trim().toUpperCase();
  const num = (input.jerseyNumber ?? '').replace(/^#/, '').trim();
  const id = `${ns}-photo-clip`;
  const photo = input.photoUrl
    ? `<g clip-path="url(#${id})"><g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})" data-photo-placement="true"><image href="${esc(input.photoUrl)}" x="0" y="0" width="${SIMPLE_CARD_W}" height="${photoHeight}" preserveAspectRatio="xMidYMid meet" data-testid="svg-card-photo"/></g></g>`
    : `<g aria-hidden="true"><circle cx="300" cy="345" r="100" fill="#D7E8F7" opacity=".18"/><path d="M120 840Q145 540 300 540T480 840Z" fill="#D7E8F7" opacity=".18"/></g>`;
  const logo = input.logoUrl ? `<rect x="14" y="14" width="208" height="74" rx="8" fill="#ffffff" fill-opacity=".96"/><image href="${esc(input.logoUrl)}" x="22" y="20" width="190" height="62" preserveAspectRatio="xMinYMin meet" data-testid="svg-card-logo"/>` : '';
  const nameFont = "Barlow Condensed, Impact, sans-serif";
  const L = (nameW: number, nx: number, overPhoto = false) => {
    const n = fit(name, overPhoto ? 54 : name.length > 14 ? 54 : 66, nameW, nameFont);
    const t = fit(team, overPhoto ? 18 : 20, nameW, 'DM Sans, sans-serif', 800, 'letter-spacing="3"');
    const p = fit(position, 15, nameW, 'DM Sans, sans-serif', 800, 'letter-spacing="2"');
    const outline = overPhoto ? 'paint-order="stroke" stroke="#061427" stroke-width="8" stroke-linejoin="round"' : '';
    const nameY = overPhoto ? 780 : 785;
    const teamY = 825;
    const positionY = 858;
    return `<text x="${nx}" y="${nameY}" fill="#edf3f6" data-testid="svg-card-athlete-name" ${n.attrs} ${outline}>${esc(name)}</text>${team ? `<text x="${nx}" y="${teamY}" fill="#8ecbff" data-testid="svg-card-team-name" ${t.attrs} ${outline}>${esc(team)}</text>` : ''}${position ? `<text x="${nx}" y="${positionY}" fill="#8ecbff" data-testid="svg-card-position" ${p.attrs} ${outline}>${esc(position)}</text>` : ''}`;
  };
  const numTxt = (cx: number, fill: string, size = 110, overPhoto = false) => num ? `<text x="${cx}" y="844" text-anchor="middle" fill="${fill}" font-family="Anton, Impact, sans-serif" font-size="${size}" ${overPhoto ? 'paint-order="stroke" stroke="#061427" stroke-width="10" stroke-linejoin="round"' : ''} ${num.length > 2 ? `textLength="150" lengthAdjust="spacingAndGlyphs"` : ''}>${esc(num)}</text>` : '';
  let lower = '';
  if (style === 'classic') {
    lower = `<rect y="${LOWER_THIRD_TOP}" width="600" height="${LOWER_THIRD_HEIGHT}" fill="#0b2039"/><rect y="${LOWER_THIRD_TOP}" width="600" height="6" fill="#ff7849"/>${L(num ? 390 : 540, 28)}${numTxt(510, '#ff7849')}`;
  } else if (style === 'split') {
    lower = `<rect y="${LOWER_THIRD_TOP}" width="600" height="${LOWER_THIRD_HEIGHT}" fill="#0b2039"/><rect x="400" y="${LOWER_THIRD_TOP}" width="200" height="${LOWER_THIRD_HEIGHT}" fill="#ff7849"/>${L(350, 28)}${numTxt(500, '#0b2039', 120)}`;
  } else if (style === 'angled') {
    lower = `<polygon points="0,780 600,${LOWER_THIRD_TOP} 600,${SIMPLE_CARD_H} 0,${SIMPLE_CARD_H}" fill="#0b2039"/><polygon points="0,770 600,${LOWER_THIRD_TOP - 10} 600,${LOWER_THIRD_TOP + 2} 0,782" fill="#ff7849"/>${L(num ? 390 : 540, 28, true)}${numTxt(510, '#ff7849', 96, true)}`;
  } else {
    lower = `${L(num ? 390 : 540, 28, true)}${numTxt(510, '#ff7849', 86, true)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${SIMPLE_CARD_W} ${SIMPLE_CARD_H}" width="${SIMPLE_CARD_W}" height="${SIMPLE_CARD_H}" preserveAspectRatio="xMidYMid meet" data-lower-third="${style}"><defs><clipPath id="${id}"><rect x="0" y="0" width="${SIMPLE_CARD_W}" height="${photoHeight}"/></clipPath><linearGradient id="${ns}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#113458"/><stop offset="1" stop-color="#081a30"/></linearGradient></defs><rect width="${SIMPLE_CARD_W}" height="${SIMPLE_CARD_H}" fill="url(#${ns}-bg)"/>${photo}<rect y="0" width="${SIMPLE_CARD_W}" height="110" fill="#061427" opacity=".35" clip-path="url(#${id})"/>${logo}${lower}</svg>`;
}
