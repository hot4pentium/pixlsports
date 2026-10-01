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