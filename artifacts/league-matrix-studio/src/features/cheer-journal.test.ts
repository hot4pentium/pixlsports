import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySendResult,
  cheerScope,
  claimCelebration,
  claimCelebrationLocked,
  celebrationCandidate,
  recordEndIntentLocked,
  type LockManagerLike,
  completionToCelebrate,
  emptyJournal,
  markCelebrated,
  ownerCompletionToCelebrate,
  personalTally,
  readJournal,
  reconcilePendingCheers,
  recordIntent,
  rejectIntent,
  sendJournaledCheer,
  writeJournal,
} from './cheer-journal';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}
const completion = (id: string, gameId: string, endedAt = '2026-05-01T20:00:00Z') => ({
  id, gameId, eventId: 'evt', athleteName: 'Maya Ortiz', eventTitle: 'vs Riverside', sport: 'soccer', seasonId: null, endedAt,
  cheers: [{ key: 'goal', label: 'Goal', emoji: 'x', count: 7 }],
});
const live = (receipt?: { id: string; gameId: string; cheerKey: string }) => ({ active: true, gameId: 'g1', cheers: [], seasonCheers: [], ...(receipt ? { receipt } : {}) });

test('duplicate receipts count exactly once', () => {
  let j = recordIntent(emptyJournal(), { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = recordIntent(j, { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = applySendResult(j, ids[0], { receipt: { id: ids[0], gameId: 'g1', cheerKey: 'goal' } });
  j = applySendResult(j, ids[0], { receipt: { id: ids[0], gameId: 'g1', cheerKey: 'goal' } });
  assert.deepEqual(personalTally(j, 'g1'), { confirmed: 1, pending: 0, unverified: 0, contributed: true, eligible: true, reliable: true });
});

test('pending is separate and a confirmed receipt is never undone by a later 409', () => {
  let j = recordIntent(emptyJournal(), { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = recordIntent(j, { id: ids[1], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = applySendResult(j, ids[0], { receipt: { id: ids[0], gameId: 'g1', cheerKey: 'goal' } });
  assert.equal(personalTally(j, 'g1').pending, 1);
  j = rejectIntent(j, ids[0]);
  j = rejectIntent(j, ids[1]);
  assert.deepEqual(personalTally(j, 'g1'), { confirmed: 1, pending: 0, unverified: 0, contributed: true, eligible: true, reliable: true });
});

test('legacy success without receipt is unknown, not invented', () => {
  let j = recordIntent(emptyJournal(), { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = applySendResult(j, ids[0], {});
  const tally = personalTally(j, 'g1');
  assert.equal(tally.confirmed, 0);
  assert.equal(tally.reliable, false);
  assert.equal(tally.contributed, true);
});

test('receipt for another game does not confirm', () => {
  let j = recordIntent(emptyJournal(), { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = applySendResult(j, ids[0], { receipt: { id: ids[0], gameId: 'g2', cheerKey: 'goal' } });
  assert.equal(personalTally(j, 'g1').confirmed, 0);
  assert.equal(personalTally(j, 'g2').contributed, false);
});

test('lost reply replay with same id is recovered exactly once; 409 rejects', async () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  const sent: unknown[] = [];
  await assert.rejects(sendJournaledCheer({ storage, scope, inviteToken: 'inv', cheerKey: 'goal', gameId: 'g1', eventId: 'evt', id: ids[0],
    send: async () => { throw new TypeError('network'); } }));
  await assert.rejects(sendJournaledCheer({ storage, scope, inviteToken: 'inv', cheerKey: 'goal', gameId: 'g1', id: ids[1],
    send: async () => { throw new TypeError('network'); } }));
  assert.equal(personalTally(readJournal(storage, scope), 'g1').pending, 2);
  const send = async (v: { data: { clientMutationId?: string } }) => {
    sent.push(v.data);
    if (v.data.clientMutationId === ids[1]) throw Object.assign(new Error('closed'), { status: 409 });
    return live({ id: ids[0], gameId: 'g1', cheerKey: 'goal' });
  };
  assert.deepEqual(await reconcilePendingCheers({ storage, scope, inviteToken: 'inv', authorized: true, online: true, send }), { confirmed: 1, rejected: 1 });
  assert.deepEqual(await reconcilePendingCheers({ storage, scope, inviteToken: 'inv', authorized: true, online: true, send }), { confirmed: 0, rejected: 0 });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { cheerKey: 'goal', gameId: 'g1', clientMutationId: ids[0], expectedEventId: 'evt' });
  assert.deepEqual(personalTally(readJournal(storage, scope), 'g1'), { confirmed: 1, pending: 0, unverified: 0, contributed: true, eligible: true, reliable: true });
});

test('no retries offline or unauthorized; no credentials persisted', async () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  await assert.rejects(sendJournaledCheer({ storage, scope, inviteToken: 'inv', cheerKey: 'goal', gameId: 'g1', accessToken: 'A'.repeat(48), id: ids[0],
    send: async () => { throw new TypeError('network'); } }));
  let calls = 0;
  const send = async () => { calls += 1; return live(); };
  await reconcilePendingCheers({ storage, scope, inviteToken: 'inv', authorized: true, online: false, send });
  await reconcilePendingCheers({ storage, scope, inviteToken: 'inv', authorized: false, online: true, send });
  assert.equal(calls, 0);
  assert.ok(![...storage.map.values()].some((v) => v.includes('AAAA')));
});

test('per-game and per-account scopes are isolated', () => {
  const storage = memory();
  const a = cheerScope('inv', 'user_a');
  const b = cheerScope('inv', 'user_b');
  const fam = cheerScope('inv', null);
  writeJournal(storage, a, recordIntent(emptyJournal(), { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null }));
  assert.equal(personalTally(readJournal(storage, b), 'g1').contributed, false);
  assert.equal(personalTally(readJournal(storage, fam), 'g1').contributed, false);
  assert.equal(personalTally(readJournal(storage, a), 'g2').contributed, false);
});

test('celebration requires contribution, fires once, history alone is silent', () => {
  let j = emptyJournal();
  assert.equal(completionToCelebrate(j, [completion('c1', 'g1')]), null);
  j = recordIntent(j, { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  assert.equal(completionToCelebrate(j, [completion('c1', 'g1')]), null, 'pending intent alone is not eligible');
  j = applySendResult(j, ids[0], { receipt: { id: ids[0], gameId: 'g1', cheerKey: 'goal' } });
  assert.equal(completionToCelebrate(j, [completion('c0', 'g0'), completion('c1', 'g1')])?.id, 'c1');
  j = markCelebrated(j, 'c1');
  assert.equal(completionToCelebrate(j, [completion('c1', 'g1')]), null);
  j = rejectIntent(recordIntent(j, { id: ids[1], gameId: 'g2', cheerKey: 'goal', eventId: null }), ids[1]);
  assert.equal(completionToCelebrate(j, [completion('c2', 'g2')]), null);
  assert.equal(ownerCompletionToCelebrate(j, completion('c3', 'g3'))?.id, 'c3');
  assert.equal(ownerCompletionToCelebrate(markCelebrated(j, 'c3'), completion('c3', 'g3')), null);
});

test('corrupt storage is ignored safely', () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  storage.setItem(`pixlSports:cheerJournal:v1:${scope}`, '{bad');
  assert.deepEqual(readJournal(storage, scope), emptyJournal());
});

test('receipt with a different cheerKey does not confirm', () => {
  let j = recordIntent(emptyJournal(), { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = applySendResult(j, ids[0], { receipt: { id: ids[0], gameId: 'g1', cheerKey: 'save' } });
  assert.equal(personalTally(j, 'g1').confirmed, 0);
  assert.equal(personalTally(j, 'g1').reliable, false);
});

test('legacy accepted success is eligible but count stays unknown', () => {
  let j = recordIntent(emptyJournal(), { id: ids[0], gameId: 'g1', cheerKey: 'goal', eventId: null });
  j = applySendResult(j, ids[0], {});
  assert.equal(completionToCelebrate(j, [completion('c1', 'g1')])?.id, 'c1');
});

test('journal is never truncated', () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  let j = emptyJournal();
  for (let i = 0; i < 900; i += 1) {
    const id = `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
    j = applySendResult(recordIntent(j, { id, gameId: 'g1', cheerKey: 'goal', eventId: null }), id, { receipt: { id, gameId: 'g1', cheerKey: 'goal' } });
    j = markCelebrated(j, 'c' + i);
  }
  writeJournal(storage, scope, j);
  const back = readJournal(storage, scope);
  assert.equal(personalTally(back, 'g1').confirmed, 900);
  assert.equal(back.celebrated.length, 900);
});

test('claimCelebration persists first and fails closed', () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  assert.ok(claimCelebration(storage, scope, 'c1'));
  assert.equal(claimCelebration(storage, scope, 'c1'), null, 'never replays');
  const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.equal(claimCelebration(broken, scope, 'c2'), null);
  const silent = { getItem: () => null, setItem: () => undefined };
  assert.equal(claimCelebration(silent, scope, 'c3'), null, 'unverifiable write fails closed');
});

test('recovered receipt makes a returning fan eligible with confirmed count', async () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  await assert.rejects(sendJournaledCheer({ storage, scope, inviteToken: 'inv', cheerKey: 'goal', gameId: 'g1', id: ids[0], send: async () => { throw new TypeError('lost'); } }));
  assert.equal(completionToCelebrate(readJournal(storage, scope), [completion('c1', 'g1')]), null);
  await reconcilePendingCheers({ storage, scope, inviteToken: 'inv', authorized: true, online: true, send: async () => ({ ...live({ id: ids[0], gameId: 'g1', cheerKey: 'goal' }), active: false }) });
  const j = readJournal(storage, scope);
  assert.equal(completionToCelebrate(j, [completion('c1', 'g1')])?.id, 'c1');
  assert.equal(personalTally(j, 'g1').confirmed, 1);
});

// Simulates navigator.locks shared by two tabs: exclusive, FIFO, async-yielding.
function sharedLocks(): LockManagerLike {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request(name, _options, callback) {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(() => new Promise((r) => setTimeout(r, 1))).then(() => callback());
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
}

test('two tabs racing to claim the same completion: exactly one wins', async () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  const locks = sharedLocks();
  const results = await Promise.all([
    claimCelebrationLocked({ storage, scope, locks }, 'c1'),
    claimCelebrationLocked({ storage, scope, locks }, 'c1'),
    claimCelebrationLocked({ storage, scope, locks }, 'c1'),
  ]);
  assert.equal(results.filter((r) => r.status === 'claimed').length, 1);
  assert.equal(results.filter((r) => r.status === 'already').length, 2);
});

test('claim fails closed without an atomic lock facility', async () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  assert.deepEqual(await claimCelebrationLocked({ storage, scope, locks: null }, 'c1'), { status: 'unavailable' });
  assert.equal(readJournal(storage, scope).celebrated.length, 0);
});

test('concurrent tabs sending and recovering do not lose each other\'s receipts', async () => {
  const storage = memory();
  const scope = cheerScope('inv', null);
  const locks = sharedLocks();
  const ok = (id: string) => async () => live({ id, gameId: 'g1', cheerKey: 'goal' });
  await Promise.all(ids.map((id) => sendJournaledCheer({ storage, scope, locks, inviteToken: 'inv', cheerKey: 'goal', gameId: 'g1', id, send: ok(id) })));
  assert.equal(personalTally(readJournal(storage, scope), 'g1').confirmed, 3);
});

test('owner lost End reply: zero personal cheers still celebrates exactly once on return', async () => {
  const storage = memory();
  const locks = sharedLocks();
  const scope = cheerScope('inv', 'owner_1');
  assert.ok(await recordEndIntentLocked({ storage, scope, locks }, { gameId: 'g1', eventId: 'evt' }));
  // End request "fails" on the network: nothing is claimed yet.
  assert.equal(readJournal(storage, scope).celebrated.length, 0);
  const zero = { ...completion('c1', 'g1'), cheers: [{ key: 'goal', label: 'Goal', emoji: 'x', count: 0 }] };
  const journal = readJournal(storage, scope);
  assert.equal(personalTally(journal, 'g1').contributed, false);
  assert.equal(celebrationCandidate(journal, [zero], true)?.id, 'c1');
  const claims = await Promise.all([
    claimCelebrationLocked({ storage, scope, locks }, 'c1'),
    claimCelebrationLocked({ storage, scope, locks }, 'c1'),
  ]);
  assert.equal(claims.filter((c) => c.status === 'claimed').length, 1);
  assert.equal(celebrationCandidate(readJournal(storage, scope), [zero], true), null, 'no replay after claim');
});

test('owner without End intent never celebrates historical completions; account switch isolates intent', async () => {
  const storage = memory();
  const locks = sharedLocks();
  const ownerA = cheerScope('inv', 'owner_a');
  const ownerB = cheerScope('inv', 'owner_b');
  const fam = cheerScope('inv', null);
  assert.equal(celebrationCandidate(readJournal(storage, ownerA), [completion('old', 'g0')], true), null);
  await recordEndIntentLocked({ storage, scope: ownerA, locks }, { gameId: 'g1', eventId: 'evt' });
  assert.equal(celebrationCandidate(readJournal(storage, ownerB), [completion('c1', 'g1')], true), null);
  assert.equal(celebrationCandidate(readJournal(storage, fam), [completion('c1', 'g1')], false), null);
  assert.equal(celebrationCandidate(readJournal(storage, ownerA), [completion('old', 'g0')], true), null, 'other games stay historical');
});

test('End intent requires the same event when both are known', async () => {
  const storage = memory();
  const scope = cheerScope('inv', 'owner_1');
  await recordEndIntentLocked({ storage, scope, locks: sharedLocks() }, { gameId: 'g1', eventId: 'evt-a' });
  const other = { ...completion('c1', 'g1'), eventId: 'evt-b' };
  assert.equal(celebrationCandidate(readJournal(storage, scope), [other], true), null);
});
