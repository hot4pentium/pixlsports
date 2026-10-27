const PREVIOUS_PRIVATE_SESSION_KEY = 'pixl:previous-private-session:v1';
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getBrowserStorage(): SessionStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function hasPreviousPrivateSession(storage = getBrowserStorage()): boolean {
  try {
    return storage?.getItem(PREVIOUS_PRIVATE_SESSION_KEY) === 'seen';
  } catch {
    return false;
  }
}

export function rememberPrivateSession(storage = getBrowserStorage()): void {
  try {
    storage?.setItem(PREVIOUS_PRIVATE_SESSION_KEY, 'seen');
  } catch {
    // Session recovery is only a display hint; account access is checked by the server.
  }
}

export function forgetPrivateSession(storage = getBrowserStorage()): void {
  try {
    storage?.removeItem(PREVIOUS_PRIVATE_SESSION_KEY);
  } catch {
    // Public landing remains available even when browser storage is restricted.
  }
}
