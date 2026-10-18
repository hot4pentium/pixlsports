export type HypeCardDesign = 'classic' | 'gallery' | 'spotlight' | 'breakout';
export type HypeCardLowerThirdStyle = 'classic' | 'split' | 'angled' | 'none';
export type PremiumHypeCardDesign = Exclude<HypeCardDesign, 'classic'>;
export type HypeCardBackground = 'sport' | 'stadium' | 'tunnel' | 'studio';
export type HypeCardAvatarPlacement = { athleteX: number; athleteY: number; athleteScale: number };
export type HypeCardAvatarPlacements = Record<PremiumHypeCardDesign, HypeCardAvatarPlacement>;
export type HypeCardAppearance = {
  design: HypeCardDesign;
  lowerThirdStyle: HypeCardLowerThirdStyle;
  background: HypeCardBackground;
  borderColor: string;
  accentColor: string;
  accentLinked: boolean;
  removeBackground: boolean;
  athleteX: number;
  athleteY: number;
  athleteScale: number;
  avatarPlacements: HypeCardAvatarPlacements;
  namePlateX: number;
  namePlateY: number;
  jerseyNumber: string;
  position: string;
};

export const appearanceSwatches = [
  ['Blue', '#35A8FF'], ['Red', '#EF4444'], ['Green', '#22C55E'], ['Gold', '#D8AF4C'],
  ['Purple', '#A855F7'], ['Pink', '#EF3996'], ['Silver', '#A8B3C2'], ['Navy', '#10243D'],
] as const;
const premiumDesigns: PremiumHypeCardDesign[] = ['gallery', 'spotlight', 'breakout'];
const defaultAvatarPlacement = (): HypeCardAvatarPlacement => ({ athleteX: 0, athleteY: 0, athleteScale: 1 });
export const defaultCardAppearance = (design: HypeCardDesign = 'classic'): HypeCardAppearance => ({
  design,
  lowerThirdStyle: 'classic',
  background: 'sport',
  borderColor: design === 'breakout' ? '#B7C4D4' : '#EF3996',
  accentColor: design === 'breakout' ? '#B7C4D4' : '#EF3996',
  accentLinked: true,
  removeBackground: true,
  athleteX: 0, athleteY: 0, athleteScale: 1,
  avatarPlacements: {
    gallery: defaultAvatarPlacement(),
    spotlight: defaultAvatarPlacement(),
    breakout: defaultAvatarPlacement(),
  },
  namePlateX: 0, namePlateY: 0,
  jerseyNumber: '', position: '',
});
export function normalizeCardAppearance(value: unknown): HypeCardAppearance {
  const source = value && typeof value === 'object' ? value as Partial<HypeCardAppearance> : {};
  const defaults = defaultCardAppearance();
  const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
  const number = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const borderColor = color(source.borderColor, defaults.borderColor);
  const sourceDesign: HypeCardDesign = source.design === 'gallery' || source.design === 'spotlight' || source.design === 'breakout'
    ? source.design
    : 'classic';
  const design = sourceDesign;
  const legacyPlacement: HypeCardAvatarPlacement = {
    athleteX: number(source.athleteX, -.25, .25, 0),
    athleteY: number(source.athleteY, -.18, .18, 0),
    athleteScale: number(source.athleteScale, .65, 1.2, 1),
  };
  const rawPlacements = source.avatarPlacements && typeof source.avatarPlacements === 'object'
    ? source.avatarPlacements as Partial<HypeCardAvatarPlacements>
    : {};
  const readPlacement = (value: unknown): HypeCardAvatarPlacement => {
    const saved = value && typeof value === 'object' ? value as Partial<HypeCardAvatarPlacement> : legacyPlacement;
    return {
      athleteX: number(saved.athleteX, -.25, .25, legacyPlacement.athleteX),
      athleteY: number(saved.athleteY, -.18, .18, legacyPlacement.athleteY),
      athleteScale: number(saved.athleteScale, .65, 1.2, legacyPlacement.athleteScale),
    };
  };
  const avatarPlacements = Object.fromEntries(premiumDesigns.map((key) => [
    key,
    readPlacement(rawPlacements[key]),
  ])) as HypeCardAvatarPlacements;
  // Root placement fields are the legacy/current-design view. Copy them into
  // this design first, then restore the target design's independent placement.
  if (sourceDesign !== 'classic') avatarPlacements[sourceDesign] = legacyPlacement;
  const activePlacement = sourceDesign !== design && design !== 'classic'
    ? avatarPlacements[design]
    : legacyPlacement;
  return {
    design,
    lowerThirdStyle: source.lowerThirdStyle === 'split' || source.lowerThirdStyle === 'angled' || source.lowerThirdStyle === 'none' ? source.lowerThirdStyle : 'classic',
    background: source.background === 'stadium' || source.background === 'tunnel' || source.background === 'studio' ? source.background : 'sport',
    borderColor,
    accentColor: borderColor,
    accentLinked: true,
    removeBackground: source.removeBackground !== false,
    athleteX: activePlacement.athleteX,
    athleteY: activePlacement.athleteY,
    athleteScale: activePlacement.athleteScale,
    avatarPlacements,
    namePlateX: number(source.namePlateX, -.2, .2, 0),
    namePlateY: number(source.namePlateY, -.12, .12, 0),
    jerseyNumber: typeof source.jerseyNumber === 'string' ? source.jerseyNumber.trim().slice(0, 12) : '',
    position: typeof source.position === 'string' ? source.position.trim().slice(0, 80) : '',
  };
}

export function switchCardAppearanceDesign(appearance: HypeCardAppearance, design: HypeCardDesign): HypeCardAppearance {
  const current = normalizeCardAppearance(appearance);
  if (current.design === design) return current;
  const target = design === 'classic' ? defaultAvatarPlacement() : current.avatarPlacements[design];
  const breakoutColors = design === 'breakout' && current.design === 'classic'
    ? { borderColor: defaultCardAppearance('breakout').borderColor, accentColor: defaultCardAppearance('breakout').accentColor }
    : {};
  return normalizeCardAppearance({
    ...current,
    ...breakoutColors,
    design,
    athleteX: target.athleteX,
    athleteY: target.athleteY,
    athleteScale: target.athleteScale,
  });
}

export function seedCardAppearanceFromProfile(
  value: unknown,
  profile: { jerseyNumber?: string; position?: string },
): HypeCardAppearance {
  const appearance = normalizeCardAppearance(value);
  const jerseyNumber = typeof profile.jerseyNumber === 'string'
    ? profile.jerseyNumber.trim().replace(/^#/, '').slice(0, 12)
    : '';
  const position = typeof profile.position === 'string' ? profile.position.trim().slice(0, 80) : '';

  return normalizeCardAppearance({
    ...appearance,
    jerseyNumber: appearance.jerseyNumber || jerseyNumber,
    position: appearance.position || position,
  });
}

export function resolveHypeCardAthleteName(profileAthleteName: string, inviteAthleteName: string) {
  return profileAthleteName.trim() || inviteAthleteName.trim() || 'Athlete';
}
