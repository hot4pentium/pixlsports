// Only loaded by vite.athlete-owner-boundary.config.ts; never included in the app build.
export function useUser() {
  const viewer = new URLSearchParams(window.location.search).get('viewer');
  return { isLoaded: true, isSignedIn: viewer === 'owner' || viewer === 'other', user: null };
}