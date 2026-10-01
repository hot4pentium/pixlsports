import { gameOnHref } from './athlete-event-links';

export function gameOnCardPublicHref(shareToken: string) {
  return gameOnHref(shareToken);
}

export function gameOnCardPublicUrl(shareToken: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${basePath}${gameOnCardPublicHref(shareToken)}`;
}

export async function copyGameOnCardPublicLink(shareToken: string) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(gameOnCardPublicUrl(shareToken));
    return true;
  } catch {
    return false;
  }
}

export async function shareGameOnCardPublicLink(
  shareToken: string,
  title: string,
): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url: gameOnCardPublicUrl(shareToken) });
      return 'shared';
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'name' in error
        && error.name === 'AbortError'
      ) {
        return 'cancelled';
      }
    }
  }

  return await copyGameOnCardPublicLink(shareToken) ? 'copied' : 'failed';
}