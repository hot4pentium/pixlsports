import type { RosterBoardStyle } from './roster-draft';

export const rosterBoardViewBox = {
  width: 1000,
  height: 750,
} as const;

const line = '#f4f6f0';
const lineOpacity = '.78';

export function createRosterBoardGeometrySvg(style: RosterBoardStyle): string {
  const { width, height } = rosterBoardViewBox;

  if (style === 'soccer') {
    return `
      <rect width="${width}" height="${height}" fill="#245c39"/>
      <rect x="42" y="34" width="916" height="682" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <path d="M500 34v682M42 375h916" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <circle cx="500" cy="375" r="84" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <circle cx="500" cy="375" r="6" fill="#b9f34a"/>
      <rect x="42" y="190" width="154" height="370" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <rect x="804" y="190" width="154" height="370" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <rect x="42" y="278" width="62" height="194" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <rect x="896" y="278" width="62" height="194" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <circle cx="178" cy="375" r="6" fill="${line}"/>
      <circle cx="822" cy="375" r="6" fill="${line}"/>
      <path d="M196 292a84 84 0 0 1 0 166M804 292a84 84 0 0 0 0 166" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <path d="M26 330h16v90H26M974 330h-16v90h16" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
    `;
  }

  if (style === 'basketball') {
    return `
      <rect width="${width}" height="${height}" fill="#a9693e"/>
      <rect x="42" y="34" width="916" height="682" fill="none" stroke="#f4d6a6" stroke-opacity=".9" stroke-width="4"/>
      <path d="M500 34v682" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <circle cx="500" cy="375" r="78" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <rect x="42" y="246" width="178" height="258" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <rect x="780" y="246" width="178" height="258" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <circle cx="220" cy="375" r="60" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <circle cx="780" cy="375" r="60" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <path d="M42 154a270 270 0 0 1 0 442M958 154a270 270 0 0 0 0 442" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <path d="M42 154h58M42 596h58M958 154h-58M958 596h-58" fill="none" stroke="${line}" stroke-opacity="${lineOpacity}" stroke-width="4"/>
      <path d="M66 330v90M934 330v90" fill="none" stroke="#f4d6a6" stroke-width="8"/>
      <circle cx="84" cy="375" r="14" fill="none" stroke="#f4d6a6" stroke-width="4"/>
      <circle cx="916" cy="375" r="14" fill="none" stroke="#f4d6a6" stroke-width="4"/>
    `;
  }

  if (style === 'baseball') {
    return `
      <rect width="${width}" height="${height}" fill="#3e6b41"/>
      <path d="M78 370Q500 22 922 370" fill="none" stroke="#f4d6a6" stroke-opacity=".65" stroke-width="5"/>
      <path d="M500 652L78 370M500 652L922 370" fill="none" stroke="#f4d6a6" stroke-opacity=".85" stroke-width="5"/>
      <polygon points="500,400 680,526 500,652 320,526" fill="#9a744d" stroke="#f4d6a6" stroke-width="5"/>
      <circle cx="500" cy="526" r="38" fill="#7a563d" stroke="#f4d6a6" stroke-width="4"/>
      <rect x="489" y="389" width="22" height="22" transform="rotate(45 500 400)" fill="#f4f6f0"/>
      <rect x="669" y="515" width="22" height="22" transform="rotate(45 680 526)" fill="#f4f6f0"/>
      <rect x="309" y="515" width="22" height="22" transform="rotate(45 320 526)" fill="#f4f6f0"/>
      <path d="M500 652l-18-16v27l18 15 18-15v-27z" fill="#f4f6f0"/>
      <rect x="448" y="608" width="34" height="70" fill="none" stroke="#f4d6a6" stroke-width="4"/>
      <rect x="518" y="608" width="34" height="70" fill="none" stroke="#f4d6a6" stroke-width="4"/>
      <path d="M500 652L500 716" fill="none" stroke="#f4d6a6" stroke-opacity=".65" stroke-width="4"/>
    `;
  }

  return `
    <rect width="${width}" height="${height}" fill="#10271d"/>
    <path d="M500 34v682M42 375h916" stroke="#53645b" stroke-opacity=".58" stroke-width="3"/>
    <rect x="42" y="34" width="916" height="682" fill="none" stroke="#53645b" stroke-width="3"/>
    <circle cx="500" cy="375" r="104" fill="none" stroke="#53645b" stroke-opacity=".58" stroke-width="3"/>
    <circle cx="500" cy="375" r="5" fill="#b9f34a"/>
  `;
}