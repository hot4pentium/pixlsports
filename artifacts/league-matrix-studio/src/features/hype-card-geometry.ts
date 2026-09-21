export const STADIUM_CARD_CLIP = {
  x: 8,
  y: 8,
  width: 984,
  height: 1384,
  radius: 46,
} as const;

export function buildStadiumCardClipMarkup(ns: string) {
  const clip = STADIUM_CARD_CLIP;
  return `<clipPath id="stadiumCardClip-${ns}"><rect x="${clip.x}" y="${clip.y}" width="${clip.width}" height="${clip.height}" rx="${clip.radius}"/></clipPath>`;
}

export function buildStadiumLowerThirdTextMarkup({
  player,
  details,
  playerSize,
  detailsSize,
  accent,
  ns,
  offsetY = 0,
}: {
  player: string;
  details: string;
  playerSize: number;
  detailsSize: number;
  accent: string;
  ns: string;
  offsetY?: number;
}) {
  return `<g aria-label="Lower third text" filter="url(#stadiumShadow-${ns})">
        <text x="500" y="${1270 + offsetY}" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="${playerSize}" font-weight="800" letter-spacing="2" fill="#fff">${player}</text>
        <text x="500" y="${1310 + offsetY}" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="${detailsSize}" font-weight="800" letter-spacing="3" fill="${accent}">${details}</text>
      </g>`;
}