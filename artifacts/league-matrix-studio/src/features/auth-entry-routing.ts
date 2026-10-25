export type AuthEntryIntent = 'sign-in' | 'sign-up';

export type HomeEntryState = 'dashboard' | 'landing';

export function getHomeEntryState(isLoaded: boolean, isSignedIn: boolean): HomeEntryState {
  return isLoaded && isSignedIn ? 'dashboard' : 'landing';
}

export function shouldBypassAccountLifecycle(
  pathname: string,
  isLoaded: boolean,
  isSignedIn: boolean,
): boolean {
  if (pathname === '/') return !isLoaded || !isSignedIn;
  return pathname === '/season-pass-preview'
    || pathname.startsWith('/schedule/')
    || pathname.startsWith('/checklist/')
    || pathname.startsWith('/watch/')
    || pathname.startsWith('/live/')
    || pathname.startsWith('/h/')
    || pathname.startsWith('/player/')
    || pathname.startsWith('/sign-in')
    || pathname.startsWith('/sign-up');
}

export function buildAuthEntryHref(intent: AuthEntryIntent, search = ''): string {
  const path = intent === 'sign-up' ? '/sign-up' : '/sign-in';
  const redirectUrl = new URLSearchParams(search).get('redirect_url');
  return redirectUrl ? `${path}?redirect_url=${encodeURIComponent(redirectUrl)}` : path;
}