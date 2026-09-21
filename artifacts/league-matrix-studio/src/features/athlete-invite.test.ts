import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./athlete-invite.tsx', import.meta.url), 'utf8');
const hypeCardSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');

const apiSource = readFileSync(new URL('../../../api-server/src/routes/hypeCardShares.ts', import.meta.url), 'utf8');

test('public Athlete Hype Pages keep replies on-page and update recent reactions after sending', () => {
  assert.match(source, /HypeCardReplyComposer/);
  assert.match(source, /Choose a reaction and add an optional message without leaving this athlete page/);
  assert.match(source, /shareToken=\{invite\.videos\[0\]\.shareToken\}/);
  assert.match(source, /setLocalReplies/);
  assert.doesNotMatch(source, /Send your own reply →/);
});

test('posting a Hype Card opens the Athlete Hype Page with the newly active card', () => {
  assert.match(
    hypeCardSource,
    /const athleteHypePage = athleteInvites\?\.\[0\] \?\? null;/,
  );
  assert.match(
    hypeCardSource,
    /await queryClient\.invalidateQueries\(\{ queryKey: getListHypeCardSharesQueryKey\(\) \}\);[\s\S]*?if \(!isStatsOnly && !linkedExport\) \{[\s\S]*?setLocation\(athleteHypePage \? `\/player\/\$\{athleteHypePage\.inviteToken\}` : '\/studio\/athlete-page'\);/,
  );
  assert.match(
    hypeCardSource,
    /athleteHypePage && \(athleteHypePage\.paused \|\| !athleteHypePage\.showHypeCard\)[\s\S]*?showHypeCard: true,[\s\S]*?paused: false,/,
  );
  assert.match(
    hypeCardSource,
    /if \(linkedExport\) await handleExport\(url\);\s*if \(!isStatsOnly && !linkedExport\)/,
  );
  assert.match(source, /aria-expanded=\{hypeCardGuideOpen\}/);
  assert.match(source, /setSelectedPath\('card'\)/);
  assert.match(source, /setSelectedPath\('page'\)/);
  assert.match(source, /\{selectedPath === 'page' && existing &&/);
  assert.match(source, /\{selectedPath === 'page' && \(/);
  assert.match(source, /How it works/);
  assert.match(source, /Open the Hype Card editor and create the card/);
  assert.match(source, /Choose Post to Athlete Hype Page/);
  assert.match(source, /const hostedVideoQuery = \{ shareMode: 'card' as const, mediaType: 'video' as const, limit: 10 \}/);
  assert.match(source, /useListHypeCardShares\(hostedVideoQuery,/);
  assert.match(
    source,
    /downloadHypeCardShare\(video\.shareToken, \{ responseType: 'blob' \}\)/,
  );
  assert.match(
    source,
    /deleteHypeCard\.mutateAsync\(\{ shareToken: video\.shareToken \}\)/,
  );
  assert.match(
    source,
    /invalidateQueries\(\{ queryKey: getListHypeCardSharesQueryKey\(hostedVideoQuery\) \}\)/,
  );
  assert.match(source, /staleTime: 10_000,[\s\S]*?refetchOnMount: 'always'/);
  assert.match(source, /data-testid="hosted-video-list"/);
  assert.match(source, /data-testid="hosted-video-title"/);
  assert.match(source, /data-testid="button-download-hosted-video"/);
  assert.match(source, /data-testid="button-remove-hosted-video"/);
  assert.match(source, /data-testid="hosted-image-hype-card"/);
  assert.match(source, /getListHypeCardSharesQueryKey\(hostedImageQuery\)/);
  assert.match(source, /data-testid="input-athlete-invite-url"/);
  assert.match(source, /data-testid="section-visible-athlete-page"/);
  assert.match(
    apiSource,
    /eq\(hypeCardSharesTable\.ownerClerkUserId, getRequiredClerkUserId\(res\)\),[\s\S]*?isNull\(hypeCardSharesTable\.revokedAt\),[\s\S]*?gt\(hypeCardSharesTable\.expiresAt, new Date\(\)\)/,
  );
  assert.match(source, /value=\{inviteUrl\(existing\.inviteToken\)\}/);
  assert.match(source, /Visible sections/);
  assert.match(source, /The Athlete Hype Page and its other content were not changed/);
  assert.match(source, /data-testid="select-athlete-trend-stat"/);
  assert.match(source, /data-testid="athlete-stat-trend-details"/);
  assert.match(source, /trendGames = invite\.stats\?\.games/);
  assert.match(source, /Finalized only/);
});

test('public Athlete Hype Pages present direct videos in an accessible horizontal carousel', () => {
  assert.match(source, /data-testid="athlete-video-carousel"/);
  assert.match(source, /invite\.videos\.map\(\(video, index\)/);
  assert.match(source, /src=\{video\.videoUrl\}/);
  assert.match(source, /poster=\{video\.posterUrl \?\? undefined\}/);
  assert.match(source, /controls/);
  assert.match(source, /playsInline/);
  assert.match(source, /preload="metadata"/);
  assert.match(source, /aria-label=\{`Play \$\{video\.title\}`\}/);
  assert.match(source, /video\.jerseyNumber/);
  assert.match(source, /video\.position/);
  assert.match(source, /snap-x snap-mandatory/);
  assert.match(source, /event\.key === 'ArrowLeft'/);
  assert.match(source, /event\.key === 'ArrowRight'/);
  assert.match(source, /if \(event\.target !== event\.currentTarget\) return/);
  assert.match(source, /aria-label="Previous video"/);
  assert.match(source, /aria-label="Next video"/);
  assert.match(source, /data-testid="athlete-video-empty-state"/);
  assert.match(source, /invite\.hypeCard\?\.mediaType === 'image'/);
  assert.match(source, /data-testid="athlete-image-hype-card"/);
  assert.match(source, /Open image Hype Card/);
  assert.doesNotMatch(source, /src=\{invite\.hypeCard\.posterUrl\}[\s\S]*?data-testid="athlete-video-player"/);
});
