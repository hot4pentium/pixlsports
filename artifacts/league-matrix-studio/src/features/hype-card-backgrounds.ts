import stadium from '../assets/hype-bg-stadium.webp?inline';
import tunnel from '../assets/hype-bg-tunnel.webp?inline';
import studio from '../assets/hype-bg-studio.webp?inline';
import type { HypeCardBackground } from './hype-card-appearance';

// Inline the preset bytes so SVG and PNG exports stay self-contained.
export const hypeCardBackgrounds: Array<{ id: HypeCardBackground; label: string; image?: string }> = [
  { id: 'sport', label: 'Match sport' },
  { id: 'stadium', label: 'Stadium', image: stadium },
  { id: 'tunnel', label: 'Tunnel', image: tunnel },
  { id: 'studio', label: 'Studio', image: studio },
];

export function hypeCardBackgroundImage(background: HypeCardBackground) {
  return hypeCardBackgrounds.find((preset) => preset.id === background)?.image;
}