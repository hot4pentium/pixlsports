import { useSyncExternalStore, type ReactNode } from 'react';

let id = new URLSearchParams(location.search).get('viewer') || '';
const apiOrigin = new URLSearchParams(location.search).get('api') || '';
const statTrackerReturnTest = new URLSearchParams(location.search).get('statTrackerReturnTest') === '1';
const workspaceSoccer = new URLSearchParams(location.search).has('workspace-soccer');
const listeners = new Set<() => void>();
const clerkListeners = new Set<(state: { user: ReturnType<typeof currentUser> }) => void>();
let firstSaveUnsafeMetadata: Record<string, unknown> = {};
let firstSaveProfileLoaded = false;
let userLoaded = id !== 'first-save-supporter';

declare global {
  interface Window {
    __lastLifecycleSignOutRedirectUrl?: string | null;
  }
}

function currentUser(unsafeMetadata?: Record<string, unknown>) {
  if (!id) return null;
  const first = id.includes('-first-');
  const workspaceJourney = id === 'workspace-journey';
  const firstSave = id === 'first-save-supporter';
  return {
    id,
    createdAt: firstSave ? Date.now() - 60_000 : Date.now() - 86_400_000,
    firstName: first ? 'Morgan' : 'Taylor',
    lastName: 'Supporter',
    primaryEmailAddress: { emailAddress: first ? 'morgan@example.test' : 'taylor@example.test' },
    publicMetadata: firstSave ? {} : { pixlSportsAccountProvisioned: true },
    unsafeMetadata: firstSave ? (unsafeMetadata ?? firstSaveUnsafeMetadata) : {
      role: 'fan', displayName: first ? 'Morgan' : 'Taylor',
      teamName: workspaceJourney ? 'Northside Comets' : first ? 'Falcons' : 'Otters',
      accessMode: 'full',
      ...(workspaceJourney ? { athleteName: 'Alexandria Montgomery-Williams', sport: workspaceSoccer ? 'soccer' : 'basketball' } : {}),
      ...(statTrackerReturnTest ? {
        displayName: 'Taylor Supporter',
        teamName: 'Northside Comets',
        athleteName: 'Alex Morgan',
        seasonName: 'Fall 2026',
      } : {}),
    },
    update: async (data: { unsafeMetadata?: Record<string, unknown> }) => {
      if (!userSnapshot || !data.unsafeMetadata) return;
      if (id === 'first-save-supporter') {
        const response = await fetch(`${apiOrigin}/__fixture/profile`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ viewer: id, unsafeMetadata: data.unsafeMetadata }),
        });
        if (!response.ok) throw new Error(`Could not persist the fixture profile (${response.status})`);
        firstSaveUnsafeMetadata = { ...data.unsafeMetadata };
      }
      userSnapshot = currentUser(data.unsafeMetadata);
      const state = { user: userSnapshot };
      for (const listener of clerkListeners) listener(state);
      for (const listener of listeners) listener();
    },
  };
}

let userSnapshot = currentUser();

if (id === 'first-save-supporter') {
  void fetch(`${apiOrigin}/__fixture/profile?viewer=${encodeURIComponent(id)}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not restore the fixture profile (${response.status})`);
      const profile = await response.json() as { unsafeMetadata?: Record<string, unknown> };
      firstSaveUnsafeMetadata = profile.unsafeMetadata ?? {};
      userSnapshot = currentUser(firstSaveUnsafeMetadata);
      userLoaded = true;
      const state = { user: userSnapshot };
      for (const listener of clerkListeners) listener(state);
      for (const listener of listeners) listener();
    })
    .catch((error: unknown) => {
      console.error(error);
      userLoaded = true;
      for (const listener of listeners) listener();
    });
}

export function switchAccount(nextId: string) {
  id = nextId;
  userLoaded = nextId !== 'first-save-supporter';
  userSnapshot = currentUser();
  const state = { user: userSnapshot };
  for (const listener of clerkListeners) listener(state);
  for (const listener of listeners) listener();
}

export function currentAccountId() { return id; }

export function useUser() {
  const user = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => userSnapshot,
  );
  return { user, isLoaded: userLoaded, isSignedIn: Boolean(user) };
}

const clerk = {
  addListener: (listener: (state: { user: ReturnType<typeof currentUser> }) => void) => {
    clerkListeners.add(listener);
    listener({ user: currentUser() });
    return () => { clerkListeners.delete(listener); };
  },
  signOut: async ({ redirectUrl }: { redirectUrl?: string } = {}) => {
    window.__lastLifecycleSignOutRedirectUrl = redirectUrl ?? null;
    switchAccount('');
    if (redirectUrl) {
      window.history.pushState({}, '', redirectUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  },
};
export function useClerk() { return clerk; }
export function ClerkProvider({ children }: { children: ReactNode }) { return <>{children}</>; }
export function Show({ children, when }: { children: ReactNode; when: string }) {
  const { isSignedIn } = useUser();
  return (when === 'signed-in' ? isSignedIn : !isSignedIn) ? <>{children}</> : null;
}
export function SignIn() { return null; }
export function SignUp() { return null; }