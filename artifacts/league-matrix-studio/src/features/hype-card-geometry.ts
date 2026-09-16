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