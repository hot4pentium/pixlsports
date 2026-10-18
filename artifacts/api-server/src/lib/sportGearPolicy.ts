export const gearSports = ["baseball", "basketball", "football", "soccer", "softball", "volleyball"] as const;
export type GearSport = typeof gearSports[number];
export type GearProgress = { activeWeeks: number; eventCardsCreated: number; trackerGamesCompleted: number; hypeCardShared: boolean };

const equipment: Record<GearSport, readonly [string, string][]> = {
  football: [["helmet", "Helmet"], ["pads", "Shoulder pads"], ["gloves", "Receiver gloves"], ["cleats", "Football cleats"]],
  soccer: [["ball", "Soccer ball"], ["shin-guards", "Shin guards"], ["cleats", "Soccer cleats"], ["wristbands", "Wristbands"]],
  basketball: [["ball", "Basketball"], ["shoes", "Basketball shoes"], ["arm-sleeve", "Arm sleeve"], ["headband", "Headband"]],
  baseball: [["glove", "Fielding glove"], ["bat", "Baseball bat"], ["helmet", "Batting helmet"], ["cleats", "Baseball cleats"]],
  softball: [["glove", "Softball glove"], ["bat", "Softball bat"], ["helmet", "Batting helmet"], ["cleats", "Softball cleats"]],
  volleyball: [["ball", "Volleyball"], ["knee-pads", "Knee pads"], ["shoes", "Court shoes"], ["wristbands", "Wristbands"]],
};

export function sportGearItems(sport: GearSport, progress: GearProgress) {
  const milestones = [
    { requirement: "Save your first Event Card", earned: progress.eventCardsCreated >= 1 },
    { requirement: "Complete your first tracked game", earned: progress.trackerGamesCompleted >= 1 },
    { requirement: "Return during a distinct active week", earned: progress.activeWeeks >= 1 },
    { requirement: "Complete five tracked games", earned: progress.trackerGamesCompleted >= 5 },
  ];
  return equipment[sport].map(([id, label], index) => ({ id: `${sport}-${id}`, label, ...milestones[index] }));
}

export function invalidSportGearSelection(sport: GearSport, equippedGear: string[], progress: GearProgress) {
  const earned = new Set(sportGearItems(sport, progress).filter((item) => item.earned).map((item) => item.id));
  return new Set(equippedGear).size !== equippedGear.length || equippedGear.some((id) => !earned.has(id));
}

export const defaultSportGearLoadout = () => ({ jerseyColor: "#2878F5", equippedGear: [] as string[] });

const allEarned = { activeWeeks: 3, eventCardsCreated: 10, trackerGamesCompleted: 5, hypeCardShared: true };
export const publicGearArtFiles = new Set([
  ...gearSports.flatMap((sport) => sportGearItems(sport, allEarned).flatMap((item) => [`${item.id}.webp`, `${item.id}-outline.webp`])),
  "football-jersey-base.webp", "football-jersey-mask.webp",
]);
