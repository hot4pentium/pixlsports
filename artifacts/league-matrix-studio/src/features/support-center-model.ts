export const SUPPORT_ISSUES = [
  { id: 'account', label: 'Sign-in or account access', steps: ['Refresh the page and confirm you are signed in with the account you normally use.', 'If you see an access or suspension notice, do not create another account; send a ticket.', 'Never put a password or sign-in code in a ticket.'] },
  { id: 'billing', label: 'Billing or plan', steps: ['Check which account you are signed in with.', 'Have the plan name and approximate date of the charge ready.', 'Never share full card numbers.'] },
  { id: 'schedule', label: 'Schedule or sync', steps: ['Run the quick checks, then refresh the schedule once.', 'Reopen the schedule and check whether your changes are still there.', 'If a change is waiting to save, keep the page open and do not clear browser data.'] },
  { id: 'game-day', label: 'Game-day tools', steps: ['Refresh the studio and open the game card again.', 'Check the card belongs to the event you intended.', 'Note what you tapped last before things went wrong.'] },
  { id: 'hype-card', label: 'HYPE Card or photo upload', steps: ['Check your connection and retry once the page finishes loading.', 'Confirm the file is a supported image or video type.', 'Tickets never include your photo or its filename.'] },
  { id: 'other', label: 'Something else', steps: ['Try the quick checks below.', 'Say what you expected and what happened instead.', 'Add the device you were using.'] },
] as const;

export type SupportIssueId = (typeof SUPPORT_ISSUES)[number]['id'];
export type SupportDiagnostics = {
  connection: 'online' | 'offline' | 'not-run';
  browserStorage: 'available' | 'unavailable' | 'not-run';
  service: 'available' | 'unavailable' | 'not-run';
};
export const EMPTY_SUPPORT_DIAGNOSTICS: SupportDiagnostics = { connection: 'not-run', browserStorage: 'not-run', service: 'not-run' };

export function getSupportIssue(issueId: string) {
  return SUPPORT_ISSUES.find((i) => i.id === issueId) ?? SUPPORT_ISSUES[SUPPORT_ISSUES.length - 1];
}

export function probeBrowserStorage(storage: Pick<Storage, 'setItem' | 'removeItem'>, probeId: string): boolean {
  const key = `pixlsports-support-check:${probeId}`;
  try { storage.setItem(key, 'available'); storage.removeItem(key); return true; }
  catch { try { storage.removeItem(key); } catch { /* blocked */ } return false; }
}

export function isValidSupportReplyEmail(value: string) {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const SUPPORT_TICKETS_STORAGE_KEY = 'pixlsports.support.anonymous-tickets.v1';
export type StoredTicketAccess = { id: string; token: string };

export function readStoredTicketAccess(): StoredTicketAccess[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SUPPORT_TICKETS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is StoredTicketAccess => typeof e?.id === 'string' && typeof e?.token === 'string')
      .map((e) => ({ id: e.id, token: e.token }));
  } catch { return []; }
}
export function writeStoredTicketAccess(entries: StoredTicketAccess[]) {
  try { window.localStorage.setItem(SUPPORT_TICKETS_STORAGE_KEY, JSON.stringify(entries)); } catch { /* storage blocked */ }
}
