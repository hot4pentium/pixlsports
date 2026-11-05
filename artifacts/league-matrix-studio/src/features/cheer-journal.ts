// Browser-only, credential-free receipt journal for Live Tap cheers.
// Stores only cheer intent ids (UUIDs), game ids, and outcomes. Never access tokens or grant ids.
import type {
  AthleteInviteLiveTapCheer,
  AthleteInviteLiveTapInput,
  AthleteInviteLiveTaps,
  LiveTapCompletion,
} from '@workspace/api-client-react';

export type JournalStatus = 'pending' | 'confirmed' | 'unverified' | 'rejected';
export type JournalEntry = {
  id: string;
  gameId: string;
  cheerKey: string;
  eventId: string | null;
  status: JournalStatus;
  createdAt: number;
};
/** Owner-only: an End the owner sent for an exact game/event, recorded before the request. */
export type EndIntent = { gameId: string; eventId: string | null; createdAt: number };
export type CheerJournal = { version: 1; entries: JournalEntry[]; celebrated: string[]; endIntents: EndIntent[] };
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type CheerScope = string;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner scope is tied to the signed-in account; family scope to the invite on this device. */
export function cheerScope(inviteToken: string, ownerUserId: string | null | undefined): CheerScope | null {
  if (!inviteToken) return null;
  return ownerUserId
    ? `owner:${encodeURIComponent(ownerUserId)}:${encodeURIComponent(inviteToken)}`
    : `family:${encodeURIComponent(inviteToken)}`;
}

function storageKey(scope: CheerScope) {
  return `pixlSports:cheerJournal:v1:${scope}`;
}

export function emptyJournal(): CheerJournal {
  return { version: 1, entries: [], celebrated: [], endIntents: [] };
}

export function readJournal(storage: StorageLike | null, scope: CheerScope | null): CheerJournal {
  if (!storage || !scope) return emptyJournal();
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(scope)) ?? 'null') as Partial<CheerJournal> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return emptyJournal();
    const seen = new Set<string>();
    const entries = parsed.entries.filter((entry): entry is JournalEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const ok = typeof entry.id === 'string' && uuidPattern.test(entry.id)
        && typeof entry.gameId === 'string' && entry.gameId.length > 0
        && typeof entry.cheerKey === 'string'
        && ['pending', 'confirmed', 'unverified', 'rejected'].includes(entry.status)
        && !seen.has(entry.id);
      if (ok) seen.add(entry.id);
      return ok;
    }).map((entry) => ({ ...entry, eventId: typeof entry.eventId === 'string' ? entry.eventId : null }));
    const celebrated = Array.isArray(parsed.celebrated) ? parsed.celebrated.filter((id) => typeof id === 'string') : [];
    const endIntents = Array.isArray(parsed.endIntents)
      ? parsed.endIntents.filter((item): item is EndIntent => Boolean(item) && typeof item.gameId === 'string' && item.gameId.length > 0)
        .map((item) => ({ gameId: item.gameId, eventId: typeof item.eventId === 'string' ? item.eventId : null, createdAt: Number(item.createdAt) || 0 }))
      : [];
    return { version: 1, entries, celebrated, endIntents };
  } catch {
    return emptyJournal();
  }
}

export function writeJournal(storage: StorageLike | null, scope: CheerScope | null, journal: CheerJournal): boolean {
  if (!storage || !scope) return false;
  try {
    storage.setItem(storageKey(scope), JSON.stringify({
      version: 1,
      // Never truncated: dropping entries would lose personal counts and replay history.
      entries: journal.entries,
      celebrated: journal.celebrated,
      endIntents: journal.endIntents,
    }));
    return true;
  } catch {
    return false;
  }
}

export function recordIntent(journal: CheerJournal, intent: Omit<JournalEntry, 'status' | 'createdAt'>, now = Date.now()): CheerJournal {
  if (journal.entries.some((entry) => entry.id === intent.id)) return journal;
  return { ...journal, entries: [...journal.entries, { ...intent, status: 'pending', createdAt: now }] };
}

function setStatus(journal: CheerJournal, id: string, status: JournalStatus): CheerJournal {
  let changed = false;
  const entries = journal.entries.map((entry) => {
    if (entry.id !== id || entry.status === status) return entry;
    // A confirmed receipt is final; later replays/rejections never un-count it.
    if (entry.status === 'confirmed') return entry;
    changed = true;
    return { ...entry, status };
  });
  return changed ? { ...journal, entries } : journal;
}

/** Applies a server send result. Only an exact receipt (same id + game) confirms a personal cheer. */
export function applySendResult(journal: CheerJournal, id: string, result: Pick<AthleteInviteLiveTaps, 'receipt'>): CheerJournal {
  const entry = journal.entries.find((item) => item.id === id);
  if (!entry) return journal;
  const receipt = result.receipt;
  if (receipt && receipt.id === id && receipt.gameId === entry.gameId && receipt.cheerKey === entry.cheerKey) return setStatus(journal, id, 'confirmed');
  return setStatus(journal, id, 'unverified');
}

export function rejectIntent(journal: CheerJournal, id: string): CheerJournal {
  return setStatus(journal, id, 'rejected');
}

export type PersonalTally = {
  confirmed: number;
  pending: number;
  unverified: number;
  /** Any non-rejected intent, including still-pending ones. */
  contributed: boolean;
  /** Positive proof of accepted delivery: an exact receipt or a legacy success response. */
  eligible: boolean;
  /** True when every accepted cheer for the game has an exact receipt. */
  reliable: boolean;
};

export function personalTally(journal: CheerJournal, gameId: string | null | undefined): PersonalTally {
  const entries = gameId ? journal.entries.filter((entry) => entry.gameId === gameId) : [];
  const confirmed = entries.filter((entry) => entry.status === 'confirmed').length;
  const pending = entries.filter((entry) => entry.status === 'pending').length;
  const unverified = entries.filter((entry) => entry.status === 'unverified').length;
  return {
    confirmed,
    pending,
    unverified,
    contributed: confirmed + pending + unverified > 0,
    eligible: confirmed + unverified > 0,
    reliable: unverified === 0,
  };
}

export function pendingIntents(journal: CheerJournal): JournalEntry[] {
  return journal.entries.filter((entry) => entry.status === 'pending');
}

export function recordEndIntent(journal: CheerJournal, intent: { gameId: string; eventId: string | null }, now = Date.now()): CheerJournal {
  if (journal.endIntents.some((item) => item.gameId === intent.gameId && item.eventId === intent.eventId)) return journal;
  return { ...journal, endIntents: [...journal.endIntents, { ...intent, createdAt: now }] };
}

/**
 * Owner return after a possibly lost End reply: celebrate only a completion for a game
 * this account explicitly sent End for (eventId must agree when both are known).
 * Ordinary history browsing has no End intent and never opens the modal.
 */
export function endIntentCompletion(journal: CheerJournal, completions: readonly LiveTapCompletion[] | undefined): LiveTapCompletion | null {
  return (completions ?? [])
    .filter((completion) => !journal.celebrated.includes(completion.id))
    .filter((completion) => journal.endIntents.some((intent) => intent.gameId === completion.gameId
      && (!intent.eventId || !completion.eventId || intent.eventId === completion.eventId)))
    .sort((a, b) => a.endedAt && b.endedAt ? b.endedAt.localeCompare(a.endedAt) : 0)[0] ?? null;
}

/** Owner: End intent first, then participation. Fans: participation only. */
export function celebrationCandidate(journal: CheerJournal, completions: readonly LiveTapCompletion[] | undefined, owner: boolean): LiveTapCompletion | null {
  return (owner ? endIntentCompletion(journal, completions) : null) ?? completionToCelebrate(journal, completions);
}

export function markCelebrated(journal: CheerJournal, completionId: string): CheerJournal {
  return journal.celebrated.includes(completionId) ? journal : { ...journal, celebrated: [...journal.celebrated, completionId] };
}

/**
 * Persists the celebrated marker BEFORE any modal opens. Returns false (fail closed)
 * when storage cannot durably record it, so the caller must not open the modal.
 */
export function claimCelebration(storage: StorageLike | null, scope: CheerScope | null, completionId: string): CheerJournal | null {
  if (!storage || !scope) return null;
  const journal = readJournal(storage, scope);
  if (journal.celebrated.includes(completionId)) return null;
  if (!writeJournal(storage, scope, markCelebrated(journal, completionId))) return null;
  return readJournal(storage, scope).celebrated.includes(completionId) ? journal : null;
}

/**
 * Picks a completion to celebrate for a viewing participant. Requires a journaled
 * (non-rejected) contribution for that exact game, so history alone never celebrates.
 */
export function completionToCelebrate(journal: CheerJournal, completions: readonly LiveTapCompletion[] | undefined): LiveTapCompletion | null {
  const candidates = (completions ?? [])
    .filter((completion) => !journal.celebrated.includes(completion.id))
    .filter((completion) => personalTally(journal, completion.gameId).eligible)
    .sort((a, b) => a.endedAt && b.endedAt ? b.endedAt.localeCompare(a.endedAt) : 0);
  return candidates[0] ?? null;
}

/** Owner End: celebrate the returned completion once, regardless of personal taps. */
export function ownerCompletionToCelebrate(journal: CheerJournal, completion: LiveTapCompletion | null | undefined): LiveTapCompletion | null {
  if (!completion || journal.celebrated.includes(completion.id)) return null;
  return completion;
}

export function totalCheers(cheers: readonly AthleteInviteLiveTapCheer[] | undefined) {
  return (cheers ?? []).reduce((total, cheer) => total + cheer.count, 0);
}

export function lastCompletedSession(completions: readonly LiveTapCompletion[] | undefined): LiveTapCompletion | null {
  return [...(completions ?? [])].sort((a, b) => a.endedAt && b.endedAt ? b.endedAt.localeCompare(a.endedAt) : 0)[0] ?? null;
}

export function newMutationId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function errorStatus(error: unknown) {
  return error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : 0;
}

type SendFn = (variables: { inviteToken: string; data: AthleteInviteLiveTapInput }) => Promise<AthleteInviteLiveTaps>;

/** Minimal Web Locks surface so tests can supply a cross-"tab" lock manager. */
export type LockManagerLike = {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T> | T): Promise<T>;
};

export function browserLocks(): LockManagerLike | null {
  try {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

export type JournalStore = {
  storage: StorageLike | null;
  scope: CheerScope | null;
  /** Web Locks serialize journal read/modify/write across tabs. Omitted => browser default. */
  locks?: LockManagerLike | null;
};

function lockName(scope: CheerScope) {
  return `pixlSports:cheerJournal:${scope}`;
}

function resolveLocks(store: JournalStore) {
  return store.locks === undefined ? browserLocks() : store.locks;
}

/**
 * Read/modify/write under an exclusive cross-tab lock when available. Without a lock
 * manager the update still re-reads fresh storage synchronously (best effort), which is
 * acceptable for receipts because entries are merged by id, never replaced wholesale.
 */
async function update(store: JournalStore, change: (journal: CheerJournal) => CheerJournal): Promise<CheerJournal> {
  const run = () => {
    const next = change(readJournal(store.storage, store.scope));
    writeJournal(store.storage, store.scope, next);
    return next;
  };
  const locks = resolveLocks(store);
  if (!locks || !store.scope) return run();
  try {
    return await locks.request(lockName(store.scope), { mode: 'exclusive' }, run);
  } catch {
    return run();
  }
}

/** Persist the End intent under the journal lock BEFORE sending End. */
export async function recordEndIntentLocked(store: JournalStore, intent: { gameId: string; eventId: string | null }): Promise<boolean> {
  const next = await update(store, (journal) => recordEndIntent(journal, intent));
  return next.endIntents.some((item) => item.gameId === intent.gameId)
    && readJournal(store.storage, store.scope).endIntents.some((item) => item.gameId === intent.gameId);
}

export type CelebrationClaim =
  | { status: 'claimed'; journal: CheerJournal }
  | { status: 'already' }
  | { status: 'unavailable' }
  | { status: 'failed' };

/**
 * Atomic once-per-device claim. Requires an exclusive cross-tab lock; without one the
 * claim fails closed ('unavailable') so two tabs can never both open the celebration.
 */
export async function claimCelebrationLocked(store: JournalStore, completionId: string): Promise<CelebrationClaim> {
  const locks = resolveLocks(store);
  if (!store.storage || !store.scope) return { status: 'failed' };
  if (!locks) return { status: 'unavailable' };
  try {
    return await locks.request(lockName(store.scope), { mode: 'exclusive' }, (): CelebrationClaim => {
      const before = readJournal(store.storage, store.scope);
      if (before.celebrated.includes(completionId)) return { status: 'already' };
      const journal = claimCelebration(store.storage, store.scope, completionId);
      return journal ? { status: 'claimed', journal } : { status: 'failed' };
    });
  } catch {
    return { status: 'failed' };
  }
}

/**
 * Store-before-send: the intent is journaled before the request so a lost reply
 * can be checked later with the same mutation id. Network failures stay pending.
 */
export async function sendJournaledCheer(options: JournalStore & {
  inviteToken: string;
  cheerKey: string;
  gameId: string;
  eventId?: string | null;
  accessToken?: string | null;
  send: SendFn;
  id?: string;
}): Promise<{ result: AthleteInviteLiveTaps; id: string }> {
  const id = options.id ?? newMutationId();
  await update(options, (journal) => recordIntent(journal, { id, gameId: options.gameId, cheerKey: options.cheerKey, eventId: options.eventId ?? null }));
  try {
    const result = await options.send({ inviteToken: options.inviteToken, data: buildSendData(options, id) });
    await update(options, (journal) => applySendResult(journal, id, result));
    return { result, id };
  } catch (error) {
    if (errorStatus(error) === 409 || errorStatus(error) === 400) await update(options, (journal) => rejectIntent(journal, id));
    throw error;
  }
}

function buildSendData(options: { cheerKey: string; gameId: string; eventId?: string | null; accessToken?: string | null }, id: string): AthleteInviteLiveTapInput {
  return {
    cheerKey: options.cheerKey,
    gameId: options.gameId,
    clientMutationId: id,
    ...(options.eventId ? { expectedEventId: options.eventId } : {}),
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
  };
}

const inflight = new Set<string>();

/**
 * Checks uncertain sends with the SAME mutation id for their original game only.
 * Never creates new cheers. 409/400 => rejected; auth/network => stays pending.
 */
export async function reconcilePendingCheers(options: JournalStore & {
  inviteToken: string;
  accessToken?: string | null;
  authorized: boolean;
  online: boolean;
  send: SendFn;
}): Promise<{ confirmed: number; rejected: number }> {
  const outcome = { confirmed: 0, rejected: 0 };
  if (!options.authorized || !options.online || !options.scope) return outcome;
  for (const entry of pendingIntents(readJournal(options.storage, options.scope))) {
    const lock = `${options.scope}|${entry.id}`;
    if (inflight.has(lock)) continue;
    inflight.add(lock);
    try {
      const result = await options.send({
        inviteToken: options.inviteToken,
        data: buildSendData({ ...entry, accessToken: options.accessToken }, entry.id),
      });
      let newlyConfirmed = false;
      await update(options, (journal) => {
        const wasConfirmed = journal.entries.some((item) => item.id === entry.id && item.status === 'confirmed');
        const next = applySendResult(journal, entry.id, result);
        newlyConfirmed = !wasConfirmed && next.entries.some((item) => item.id === entry.id && item.status === 'confirmed');
        return next;
      });
      if (newlyConfirmed) outcome.confirmed += 1;
    } catch (error) {
      const status = errorStatus(error);
      if (status === 409 || status === 400) {
        await update(options, (journal) => rejectIntent(journal, entry.id));
        outcome.rejected += 1;
      } else if (status === 403 || status === 401) {
        break;
      }
    } finally {
      inflight.delete(lock);
    }
  }
  return outcome;
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
