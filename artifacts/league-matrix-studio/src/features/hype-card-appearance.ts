export type HypeCardDesign = 'classic' | 'gallery' | 'spotlight' | 'breakout';
export type HypeCardAppearance = {
  design: HypeCardDesign;
  borderColor: string;
  accentColor: string;
  accentLinked: boolean;
  removeBackground: boolean;
  athleteX: number;
  athleteY: number;
  athleteScale: number;
  namePlateX: number;
  namePlateY: number;
  jerseyNumber: string;
  position: string;
};

export const appearanceSwatches = [
  ['Blue', '#35A8FF'], ['Red', '#EF4444'], ['Green', '#22C55E'], ['Gold', '#D8AF4C'],
  ['Purple', '#A855F7'], ['Pink', '#EF3996'], ['Silver', '#A8B3C2'], ['Navy', '#10243D'],
] as const;
export const defaultCardAppearance = (design: HypeCardDesign = 'classic'): HypeCardAppearance => ({
  design,
  borderColor: design === 'breakout' ? '#B7C4D4' : '#EF3996',
  accentColor: design === 'breakout' ? '#26A9FF' : '#EF3996',
  accentLinked: design !== 'breakout',
  removeBackground: true,
  athleteX: 0, athleteY: 0, athleteScale: 1,
  namePlateX: 0, namePlateY: 0,
  jerseyNumber: '', position: '',
});
export function normalizeCardAppearance(value: unknown): HypeCardAppearance {
  const source = value && typeof value === 'object' ? value as Partial<HypeCardAppearance> : {};
  const defaults = defaultCardAppearance();
  const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
  const number = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const borderColor = color(source.borderColor, defaults.borderColor);
  const accentLinked = source.accentLinked !== false;
  return {
    design: source.design === 'gallery' || source.design === 'spotlight' || source.design === 'breakout' ? source.design : 'classic',
    borderColor,
    accentColor: accentLinked ? borderColor : color(source.accentColor, defaults.accentColor),
    accentLinked,
    removeBackground: source.removeBackground !== false,
    athleteX: number(source.athleteX, -.25, .25, 0),
    athleteY: number(source.athleteY, -.18, .18, 0),
    athleteScale: number(source.athleteScale, .65, 1.45, 1),
    namePlateX: number(source.namePlateX, -.2, .2, 0),
    namePlateY: number(source.namePlateY, -.12, .12, 0),
    jerseyNumber: typeof source.jerseyNumber === 'string' ? source.jerseyNumber.trim().slice(0, 12) : '',
    position: typeof source.position === 'string' ? source.position.trim().slice(0, 80) : '',
  };
}