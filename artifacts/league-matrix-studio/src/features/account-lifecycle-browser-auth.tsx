import { useSyncExternalStore, type ReactNode } from 'react';

let id = new URLSearchParams(location.search).get('viewer') || '';
const listeners = new Set<() => void>();
const clerkListeners = new Set<(state: { user: ReturnType<typeof currentUser> }) => void>();

function currentUser() {
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
    unsafeMetadata: firstSave ? {} : {
      role: 'fan', displayName: first ? 'Morgan' : 'Taylor',
      teamName: workspaceJourney ? 'Northside Comets' : first ? 'Falcons' : 'Otters',
      accessMode: 'full',
      ...(workspaceJourney ? { athleteName: 'Alexandria Montgomery-Williams', sport: 'basketball' } : {}),
    },
    update: async (data: { unsafeMetadata?: Record<string, unknown> }) => {
      if (!userSnapshot || !data.unsafeMetadata) return;
      userSnapshot = { ...userSnapshot, unsafeMetadata: data.unsafeMetadata };
      const state = { user: userSnapshot };
      for (const listener of clerkListeners) listener(state);
      for (const listener of listeners) listener();
    },
  };
}

let userSnapshot = currentUser();

export function switchAccount(nextId: string) {
  id = nextId;
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
  return { user, isLoaded: true, isSignedIn: Boolean(user) };
}

const clerk = {
  addListener: (listener: (state: { user: ReturnType<typeof currentUser> }) => void) => {
    clerkListeners.add(listener);
    listener({ user: currentUser() });
    return () => { clerkListeners.delete(listener); };
  },
  signOut: async () => switchAccount(''),
};
export function useClerk() { return clerk; }
export function ClerkProvider({ children }: { children: ReactNode }) { return <>{children}</>; }
export function Show({ children, when }: { children: ReactNode; when: string }) {
  const { isSignedIn } = useUser();
  return (when === 'signed-in' ? isSignedIn : !isSignedIn) ? <>{children}</> : null;
}
export function SignIn() { return null; }
export function SignUp() { return null; }