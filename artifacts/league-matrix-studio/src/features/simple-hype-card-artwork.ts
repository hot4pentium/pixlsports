export type LowerThirdStyle = 'classic' | 'split' | 'angled';
export const lowerThirdStyles: Array<{ id: LowerThirdStyle; label: string }> = [
  { id: 'classic', label: 'Classic' }, { id: 'split', label: 'Split' }, { id: 'angled', label: 'Angled' },
];
export type SimpleCardInput = {
  athleteName: string; teamName?: string | null; jerseyNumber?: string | null;
  photoUrl?: string | null; logoUrl?: string | null;
  lowerThirdStyle?: string | null; athleteX?: number; athleteY?: number;
};
export const SIMPLE_CARD_W = 600;
export const SIMPLE_CARD_H = 800;
const PH = 620;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export function normalizeLowerThird(v: unknown): LowerThirdStyle {
  return v === 'split' || v === 'angled' ? v : 'classic';
}
function fit(text: string, size: number, avail: number, family: string, weight = 900, extra = '') {
  const est = text.length * size * 0.47;
  return { size, attrs: `font-family="${family}" font-weight="${weight}" font-size="${size}" ${extra} ${est > avail ? `textLength="${avail}" lengthAdjust="spacingAndGlyphs"` : ''}` };
}
/** Pure SVG renderer shared by the live card and JPEG export. */
export function buildSimpleHypeCardArtwork(input: SimpleCardInput, ns = 'sc'): string {
  const style = normalizeLowerThird(input.lowerThirdStyle);
  const x = Math.max(-.25, Math.min(.25, input.athleteX ?? 0)) * SIMPLE_CARD_W;
  const y = Math.max(-.18, Math.min(.18, input.athleteY ?? 0)) * PH;
  const name = (input.athleteName || 'Athlete').toUpperCase();
  const team = (input.teamName ?? '').toUpperCase();
  const num = (input.jerseyNumber ?? '').replace(/^#/, '').trim();
  const id = `${ns}-photo-clip`;
  const initials = esc(name.split(/\s+/).slice(0, 2).map((p) => p.charAt(0)).join('') || 'P');
  const photo = input.photoUrl
    ? `<g clip-path="url(#${id})"><g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})" data-photo-placement="true"><image href="${esc(input.photoUrl)}" x="0" y="0" width="${SIMPLE_CARD_W}" height="${PH}" preserveAspectRatio="xMidYMid meet" data-testid="svg-card-photo"/></g></g>`
    : `<text x="300" y="400" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="900" font-size="260" fill="#b5d8f71f">${initials}</text>`;
  const logo = input.logoUrl ? `<rect x="14" y="14" width="208" height="74" rx="8" fill="#ffffff" fill-opacity=".96"/><image href="${esc(input.logoUrl)}" x="22" y="20" width="190" height="62" preserveAspectRatio="xMinYMin meet" data-testid="svg-card-logo"/>` : '';
  const nameFont = "Barlow Condensed, Impact, sans-serif";
  let lower = '';
  const L = (nameW: number, nx: number) => {
    const n = fit(name, name.length > 14 ? 54 : 66, nameW, nameFont);
    const t = fit(team, 20, nameW, 'DM Sans, sans-serif', 800, 'letter-spacing="3"');
    return `<text x="${nx}" y="${team ? 716 : 734}" fill="#edf3f6" data-testid="svg-card-athlete-name" ${n.attrs}>${esc(name)}</text>${team ? `<text x="${nx}" y="758" fill="#8ecbff" data-testid="svg-card-team-name" ${t.attrs}>${esc(team)}</text>` : ''}`;
  };
  const numTxt = (cx: number, fill: string, size = 110) => num ? `<text x="${cx}" y="748" text-anchor="middle" fill="${fill}" font-family="Anton, Impact, sans-serif" font-size="${size}" ${num.length > 2 ? `textLength="150" lengthAdjust="spacingAndGlyphs"` : ''}>${esc(num)}</text>` : '';
  if (style === 'classic') {
    lower = `<rect y="${PH}" width="600" height="180" fill="#0b2039"/><rect y="${PH}" width="600" height="6" fill="#ff7849"/>${L(num ? 390 : 540, 28)}${numTxt(510, '#ff7849')}`;
  } else if (style === 'split') {
    lower = `<rect y="${PH}" width="600" height="180" fill="#0b2039"/><rect x="400" y="${PH}" width="200" height="180" fill="#ff7849"/>${L(350, 28)}${numTxt(500, '#0b2039', 120)}`;
  } else {
    lower = `<polygon points="0,700 600,${PH} 600,800 0,800" fill="#0b2039"/><polygon points="0,700 600,${PH} 600,632 0,712" fill="#ff7849"/>${L(num ? 390 : 540, 28).replace(/y="716"/, 'y="738"').replace(/y="734"/, 'y="752"').replace(/y="758"/, 'y="780"')}${num ? `<text x="510" y="770" text-anchor="middle" fill="#ff7849" font-family="Anton, Impact, sans-serif" font-size="96">${esc(num)}</text>` : ''}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 800" width="600" height="800" preserveAspectRatio="xMidYMid meet" data-lower-third="${style}"><defs><clipPath id="${id}"><rect x="0" y="0" width="600" height="${PH}"/></clipPath><linearGradient id="${ns}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#113458"/><stop offset="1" stop-color="#081a30"/></linearGradient></defs><rect width="600" height="800" fill="url(#${ns}-bg)"/>${photo}<rect y="0" width="600" height="110" fill="#061427" opacity=".35" clip-path="url(#${id})"/>${logo}${lower}</svg>`;
}
