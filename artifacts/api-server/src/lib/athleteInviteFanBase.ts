export type FanBaseFollowRow = { displayName: string | null };

export function summarizeFanBase(rows: readonly FanBaseFollowRow[]) {
  const namedFans = rows
    .map(({ displayName }) => displayName?.trim() ?? "")
    .filter((displayName) => displayName.length > 0);
  return {
    totalFollows: rows.length,
    namedFans,
    anonymousFollows: rows.length - namedFans.length,
  };
}
