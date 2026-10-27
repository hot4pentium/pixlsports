export const PRIVATE_ENTRY_SPLASH_MIN_DURATION_MS = 5_000;

export function getPrivateEntrySplashRemainingMs(
  startedAt: string | null,
  now: number,
): number {
  if (startedAt === null || startedAt.trim() === '') return 0;

  const timestamp = Number(startedAt);
  if (!Number.isFinite(timestamp)) return 0;

  const elapsed = Math.max(0, now - timestamp);
  return Math.max(0, PRIVATE_ENTRY_SPLASH_MIN_DURATION_MS - elapsed);
}
