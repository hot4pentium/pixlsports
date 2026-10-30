import { useSyncExternalStore, type ReactNode } from 'react';

let id = new URLSearchParams(location.search).get('viewer') || '';
const apiOrigin = new URLSearchParams(location.search).get('api') || '';
const statTrackerReturnTest = new URLSearchParams(location.search).get('statTrackerReturnTest') === '1';
const workspaceSoccer = new URLSearchParams(location.search).has('workspace-soccer');
const listeners = new Set<() => void>();
const clerkListeners = new Set<(state: { user: ReturnType<typeof currentUser> }) => void>();
let userStateRevision = 0;
let firstSaveUnsafeMetadata: Record<string, unknown> = {};
let firstSaveProfileLoaded = false;
let userLoaded = id !== 'first-save-supporter' && !id.startsWith('startup-');

declare global {
  interface Window {
    __lastLifecycleSignOutRedirectUrl?: string | null;
    __restoreStartupSession?: () => void;
    __startupSessionVerified?: boolean;
  }
}

function currentUser(unsafeMetadata?: Record<string, unknown>) {
  if (!id) return null;
  const first = id.includes('-first-');
  const workspaceJourney = id === 'workspace-journey';
  const firstSave = id === 'first-save-supporter';
  const startupReturn = id.startsWith('startup-');
  return {
    id,
    createdAt: firstSave ? Date.now() - 60_000 : Date.now() - 86_400_000,
    firstName: first ? 'Morgan' : 'Taylor',
    lastName: 'Supporter',
    primaryEmailAddress: {
      emailAddress: first ? 'morgan@example.test' : 'taylor@example.test',
      ...(startupReturn ? { verification: { status: 'verified' } } : {}),
    },
    publicMetadata: firstSave ? {} : { pixlSportsAccountProvisioned: true },
    unsafeMetadata: firstSave ? (unsafeMetadata ?? firstSaveUnsafeMetadata) : {
      role: 'fan',
      displayName: startupReturn ? 'Casey Supporter' : first ? 'Morgan' : 'Taylor',
      teamName: startupReturn ? 'Northside Comets' : workspaceJourney ? 'Northside Comets' : first ? 'Falcons' : 'Otters',
      ...(startupReturn ? { athleteName: 'Alex Morgan', seasonName: 'Fall 2026' } : {}),
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
      notifyUserState();
    },
  };
}

let userSnapshot = id.startsWith('startup-') ? null : currentUser();

function notifyUserState() {
  userStateRevision += 1;
  for (const listener of listeners) listener();
}

if (id.startsWith('startup-')) {
  window.__restoreStartupSession = () => {
    userSnapshot = id === 'startup-signed-out' ? null : currentUser();
    userLoaded = true;
    window.__startupSessionVerified =
      userSnapshot?.primaryEmailAddress?.verification?.status === 'verified';
    const state = { user: userSnapshot };
    for (const listener of clerkListeners) listener(state);
    notifyUserState();
  };
}

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
      notifyUserState();
    })
    .catch((error: unknown) => {
      console.error(error);
      userLoaded = true;
      notifyUserState();
    });
}

export function switchAccount(nextId: string) {
  id = nextId;
  userLoaded = nextId !== 'first-save-supporter';
  userSnapshot = currentUser();
  const state = { user: userSnapshot };
  for (const listener of clerkListeners) listener(state);
  notifyUserState();
}

export function currentAccountId() { return id; }

export function useUser() {
  useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => userStateRevision,
  );
  return { user: userSnapshot, isLoaded: userLoaded, isSignedIn: Boolean(userSnapshot) };
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