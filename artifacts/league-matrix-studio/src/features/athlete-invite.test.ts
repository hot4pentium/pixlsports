import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./athlete-invite.tsx', import.meta.url), 'utf8');
const hypeCardSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');

const apiSource = readFileSync(new URL('../../../api-server/src/routes/hypeCardShares.ts', import.meta.url), 'utf8');

test('public Athlete Hype Pages keep replies on-page and update recent reactions after sending', () => {
  assert.match(source, /HypeCardReplyComposer/);
  assert.match(source, /Choose a reaction and add an optional message without leaving this athlete page/);
  assert.match(source, /shareToken=\{invite\.hypeCard\.shareToken\}/);
  assert.match(source, /setLocalReplies/);
  assert.doesNotMatch(source, /Send your own reply →/);
});

test('posting a Hype Card returns owners to the hosted card manager', () => {
  assert.match(
    hypeCardSource,
    /await queryClient\.invalidateQueries\(\{ queryKey: getListHypeCardSharesQueryKey\(\) \}\);[\s\S]*?if \(!isStatsOnly && !linkedExport\) setLocation\('\/studio\/athlete-page'\);/,
  );
  assert.match(source, /aria-expanded=\{hypeCardGuideOpen\}/);
  assert.match(source, /setSelectedPath\('card'\)/);
  assert.match(source, /setSelectedPath\('page'\)/);
  assert.match(source, /\{selectedPath === 'page' && existing &&/);
  assert.match(source, /\{selectedPath === 'page' && \(/);
  assert.match(source, /How it works/);
  assert.match(source, /Open the Hype Card editor and create the card/);
  assert.match(source, /Choose Post to Athlete Hype Page/);
  assert.match(source, /hostedHypeCard\.title/);
  assert.match(
    source,
    /downloadHypeCardShare\(hostedHypeCard\.shareToken, \{ responseType: 'blob' \}\)/,
  );
  assert.match(
    source,
    /deleteHypeCard\.mutateAsync\(\{ shareToken: hostedHypeCard\.shareToken \}\)/,
  );
  assert.match(
    source,
    /invalidateQueries\(\{ queryKey: getListHypeCardSharesQueryKey\(\) \}\)/,
  );
  assert.match(source, /staleTime: 10_000,[\s\S]*?refetchOnMount: 'always'/);
  assert.match(source, /data-testid="hosted-hype-card-title"/);
  assert.match(source, /data-testid="button-download-hosted-hype-card"/);
  assert.match(source, /data-testid="button-remove-hosted-hype-card"/);
  assert.match(source, /data-testid="input-athlete-invite-url"/);
  assert.match(source, /data-testid="section-visible-athlete-page"/);
  assert.match(
    apiSource,
    /eq\(hypeCardSharesTable\.ownerClerkUserId, getRequiredClerkUserId\(res\)\),[\s\S]*?isNull\(hypeCardSharesTable\.revokedAt\),[\s\S]*?gt\(hypeCardSharesTable\.expiresAt, new Date\(\)\)/,
  );
  assert.match(source, /value=\{inviteUrl\(existing\.inviteToken\)\}/);
  assert.match(source, /Visible sections/);
  assert.match(source, /The Athlete Hype Page and its other content were not changed/);
});
