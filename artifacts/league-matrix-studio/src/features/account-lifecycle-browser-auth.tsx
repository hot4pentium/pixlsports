import { useSyncExternalStore, type ReactNode } from 'react';

let id = new URLSearchParams(location.search).get('viewer') || '';
const listeners = new Set<() => void>();
const clerkListeners = new Set<(state: { user: ReturnType<typeof currentUser> }) => void>();

function currentUser() {
  if (!id) return null;
  const first = id.includes('-first-');
  return {
    id,
    firstName: first ? 'Morgan' : 'Taylor',
    lastName: 'Supporter',
    primaryEmailAddress: { emailAddress: first ? 'morgan@example.test' : 'taylor@example.test' },
    unsafeMetadata: { role: 'fan', displayName: first ? 'Morgan' : 'Taylor', teamName: first ? 'Falcons' : 'Otters', accessMode: 'full' },
    update: async () => undefined,
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