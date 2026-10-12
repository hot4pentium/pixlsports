export const defaultSoccerLoadout = () => ({
  jerseyStyle: "classic" as const, jerseyColor: "#2878F5",
  shortsStyle: "classic" as const, shortsColor: "#173758",
  socksStyle: "plain" as const, socksColor: "#F6F5EA",
  shinGuards: "slim" as const, shinGuardColor: "#D7EF80",
  cleatsStyle: "classic" as const, cleatsColor: "#173758",
  sweatband: "none" as const, background: "field" as const,
});

export function soccerWeekKey(now: Date) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

export function unlockedSoccerGear(progress: { activeWeeks: number; eventCardsCreated: number; hypeCardShared: boolean }) {
  return [
    ...(progress.activeWeeks >= 1 ? ["speed-cleats"] : []),
    ...(progress.activeWeeks >= 2 ? ["striped-socks"] : []),
    ...(progress.activeWeeks >= 3 ? ["contrast-shorts"] : []),
    ...(progress.eventCardsCreated >= 10 ? ["stripe-jersey"] : []),
    ...(progress.hypeCardShared ? ["sweatbands"] : []),
  ];
}

export function lockedSoccerSelection(loadout: {
  jerseyStyle: string; shortsStyle: string; socksStyle: string; cleatsStyle: string; sweatband: string;
}, unlocked: string[]) {
  return ([
    [loadout.jerseyStyle === "stripes", "stripe-jersey"],
    [loadout.shortsStyle === "contrast", "contrast-shorts"],
    [loadout.socksStyle === "stripe", "striped-socks"],
    [loadout.cleatsStyle === "speed", "speed-cleats"],
    [loadout.sweatband !== "none", "sweatbands"],
  ] as const).find(([selected, item]) => selected && !unlocked.includes(item))?.[1];
}
