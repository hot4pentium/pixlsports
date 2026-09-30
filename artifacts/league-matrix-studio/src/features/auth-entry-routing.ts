export type AuthEntryIntent = 'sign-in' | 'sign-up';

export function buildAuthEntryHref(intent: AuthEntryIntent, search = ''): string {
  const path = intent === 'sign-up' ? '/sign-up' : '/sign-in';
  const redirectUrl = new URLSearchParams(search).get('redirect_url');
  return redirectUrl ? `${path}?redirect_url=${encodeURIComponent(redirectUrl)}` : path;
}