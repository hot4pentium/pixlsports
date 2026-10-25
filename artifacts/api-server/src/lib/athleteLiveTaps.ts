import { count, eq, and } from "drizzle-orm";
import { athleteInviteLiveTapsTable, db } from "@workspace/db";

type CheerPreset = { key: string; label: string; emoji: string };

const allSportCheers: readonly CheerPreset[] = [
  { key: "thumbs-up", label: "Thumbs Up", emoji: "👍" },
  { key: "way-to-go", label: "Way to Go!", emoji: "🎉" },
  { key: "big-play", label: "Big Play", emoji: "💥" },
];

const cheerPresets: Record<string, readonly CheerPreset[]> = {
  baseball: [
    { key: "hit", label: "Big hit", emoji: "⚾" },
    { key: "home-run", label: "Home run", emoji: "🚀" },
    { key: "strikeout", label: "Strikeout", emoji: "🔥" },
    { key: "great-catch", label: "Great catch", emoji: "👏" },
    { key: "lets-go", label: "Let's go", emoji: "💙" },
  ],
  softball: [
    { key: "big-hit", label: "Big hit", emoji: "🥎" },
    { key: "home-run", label: "Home run", emoji: "🚀" },
    { key: "strikeout", label: "Strikeout", emoji: "🔥" },
    { key: "great-catch", label: "Great catch", emoji: "👏" },
    { key: "lets-go", label: "Let's go", emoji: "💙" },
  ],
  basketball: [
    { key: "bucket", label: "Bucket", emoji: "🏀" },
    { key: "three", label: "Three!", emoji: "🎯" },
    { key: "and-one", label: "And one", emoji: "💥" },
    { key: "big-stop", label: "Big stop", emoji: "🛡️" },
    { key: "lets-go", label: "Let's go", emoji: "💙" },
  ],
  football: [
    { key: "touchdown", label: "Touchdown", emoji: "🏈" },
    { key: "big-catch", label: "Big catch", emoji: "🙌" },
    { key: "big-stop", label: "Big stop", emoji: "🛡️" },
    { key: "sack", label: "Sack", emoji: "💥" },
    { key: "lets-go", label: "Let's go", emoji: "💙" },
  ],
  soccer: [
    { key: "goal", label: "Goal", emoji: "⚽" },
    { key: "assist", label: "Assist", emoji: "🎯" },
    { key: "great-save", label: "Great save", emoji: "🧤" },
    { key: "big-stop", label: "Big stop", emoji: "🛡️" },
    { key: "lets-go", label: "Let's go", emoji: "💙" },
  ],
  volleyball: [
    { key: "ace", label: "Ace", emoji: "🏐" },
    { key: "kill", label: "Kill", emoji: "💥" },
    { key: "block", label: "Block", emoji: "🛡️" },
    { key: "big-dig", label: "Big dig", emoji: "🙌" },
    { key: "lets-go", label: "Let's go", emoji: "💙" },
  ],
};

export function getLiveTapCheerPresets(sport: string): readonly CheerPreset[] {
  const sportCheers = cheerPresets[sport];
  return sportCheers ? [...allSportCheers, ...sportCheers] : [];
}

export function isLiveTapCheerForSport(sport: string, cheerKey: string) {
  return getLiveTapCheerPresets(sport).some((cheer) => cheer.key === cheerKey);
}

export async function getAthleteLiveTapsSummary(inviteId: string, sport: string, gameId: string | null) {
  const presets = getLiveTapCheerPresets(sport);
  const [seasonRows, gameRows] = await Promise.all([
    db.select({
      cheerKey: athleteInviteLiveTapsTable.cheerKey,
      total: count(),
    }).from(athleteInviteLiveTapsTable).where(
      eq(athleteInviteLiveTapsTable.inviteId, inviteId),
    ).groupBy(athleteInviteLiveTapsTable.cheerKey),
    gameId
      ? db.select({
        cheerKey: athleteInviteLiveTapsTable.cheerKey,
        total: count(),
      }).from(athleteInviteLiveTapsTable).where(and(
        eq(athleteInviteLiveTapsTable.inviteId, inviteId),
        eq(athleteInviteLiveTapsTable.gameId, gameId),
      )).groupBy(athleteInviteLiveTapsTable.cheerKey)
      : Promise.resolve([]),
  ]);
  const seasonTotals = new Map(seasonRows.map((row) => [row.cheerKey, row.total]));
  const gameTotals = new Map(gameRows.map((row) => [row.cheerKey, row.total]));
  return {
    active: Boolean(gameId),
    gameId,
    cheers: presets.map((cheer) => ({
      ...cheer,
      count: gameTotals.get(cheer.key) ?? 0,
    })),
    seasonCheers: presets.map((cheer) => ({
      ...cheer,
      count: seasonTotals.get(cheer.key) ?? 0,
    })),
  };
}