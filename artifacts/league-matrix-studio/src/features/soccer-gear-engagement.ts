import { recordSoccerGearShareAction } from '@workspace/api-client-react';

const pendingKey = (accountId: string) => `pixl-soccer-gear-share:${accountId}`;

export async function retrySoccerGearShare(accountId: string) {
  const token = localStorage.getItem(pendingKey(accountId));
  if (!token) return true;
  try {
    await recordSoccerGearShareAction({ shareToken: token });
    if (localStorage.getItem(pendingKey(accountId)) === token) localStorage.removeItem(pendingKey(accountId));
    return true;
  } catch {
    return false;
  }
}

/** Invokes the share action immediately to preserve the native share user gesture.
 * An aborted/failed action never queues or records a reward. */
export async function runGearQualifiedShareAction(
  action: () => Promise<void>, accountId: string | undefined, shareToken: string,
) {
  await action();
  if (!accountId) return true;
  try {
    localStorage.setItem(pendingKey(accountId), shareToken);
  } catch {
    // Still try server persistence when this browser disallows local storage.
    try { await recordSoccerGearShareAction({ shareToken }); return true; }
    catch { return false; }
  }
  return retrySoccerGearShare(accountId);
}
