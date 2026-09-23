import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./athlete-invite.tsx', import.meta.url), 'utf8');
const hypeCardSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const apiSource = readFileSync(new URL('../../../api-server/src/routes/hypeCardShares.ts', import.meta.url), 'utf8');
const publicPageSource = source.slice(source.indexOf('export function PublicAthleteInvitePage'));

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
  assert.match(source, /href=\{`\/player\/\$\{existing\.inviteToken\}`\}/);
  assert.match(source, /\{selectedPath === 'page' && !existing && \(/);
  assert.match(source, /How it works/);
  assert.match(source, /Open the Hype Card editor and create the card/);
  assert.match(source, /Choose Post to Athlete Hype Page/);
  assert.match(hypeCardSource, /shareMode === 'stats' && \([\s\S]*?Link Stats Project/);
  assert.match(hypeCardSource, /trackerProjectId: isStatsOnly && shareTrackerProjectId !== 'none'/);
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
  assert.match(source, /data-testid="section-manage-athlete-videos"/);
  assert.match(source, /Manage posted videos/);
  assert.match(source, /function OwnerVideoUpload/);
  assert.match(source, /Add a video here/);
  assert.match(source, /data-testid="section-manage-athlete-videos"/);
  assert.match(source, /prepareHypeCardShareMedia/);
  assert.match(source, /requestHypeCardShareUploadUrl/);
  assert.match(source, /expiresInDays: 365/);
  assert.match(source, /The original video remains on this device/);
  assert.match(source, /setProgress\(0\.01\)/);
  assert.match(source, /monotonicProgress\(current, value \* 0\.55\)/);
  assert.match(source, /data-testid="hosted-video-title"/);
  assert.match(source, /data-testid="button-download-hosted-video"/);
  assert.match(source, /data-testid="button-remove-hosted-video"/);
  assert.match(source, /data-testid="hosted-image-hype-card"/);
  assert.match(source, /getListHypeCardSharesQueryKey\(hostedImageQuery\)/);
  assert.match(source, /data-testid="input-athlete-invite-url"/);
  assert.match(source, /data-testid="section-visible-athlete-page"/);
  assert.match(source, /export function OwnerAthleteInviteManagePage/);
  assert.match(source, /data-testid="link-manage-athlete-hype-page"/);
  assert.match(source, /href=\{`\/player\/\$\{inviteToken\}\/manage`\}/);
  assert.match(publicPageSource, /aria-label=\{`Manage \$\{invite\.athleteName\}'s Hype Page`\}/);
  assert.match(publicPageSource, />\s*Manage <ChevronRight/);
  assert.match(publicPageSource, /text-\[clamp\(2\.75rem,13vw,4rem\)\]/);
  assert.match(publicPageSource, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(publicPageSource, /athlete-highlights-heading col-span-2 row-start-2[\s\S]*?lg:col-start-2 lg:row-start-1/);
  assert.match(publicPageSource, /col-start-2 row-start-1 inline-flex min-h-10[\s\S]*?text-\[10px\][\s\S]*?lg:col-start-1 lg:row-start-2/);
  assert.match(source, /<OwnerHypePageManage invite=\{ownerInvite\} \/>/);
  assert.doesNotMatch(publicPageSource, /<OwnerHypePageManage/);
  assert.match(appSource, /path="\/player\/:inviteToken\/manage" component=\{OwnerAthleteInviteManagePage\}/);
  assert.ok(
    source.indexOf('data-testid="section-visible-athlete-page"')
      < source.indexOf('data-testid="section-manage-athlete-videos"'),
    'visible section controls should appear before posted media management',
  );
  assert.match(
    apiSource,
    /eq\(hypeCardSharesTable\.ownerClerkUserId, getRequiredClerkUserId\(res\)\),[\s\S]*?isNull\(hypeCardSharesTable\.revokedAt\),[\s\S]*?gt\(hypeCardSharesTable\.expiresAt, new Date\(\)\)/,
  );
  assert.match(source, /value=\{inviteUrl\(invite\.inviteToken\)\}/);
  assert.match(source, /Visible sections/);
  assert.match(source, /The Athlete Hype Page and its other content were not changed/);
  assert.match(source, /data-testid="select-athlete-trend-stat"/);
  assert.match(source, /return 'score'/);
  assert.match(source, /athlete-trends-panel/);
  assert.match(source, /athlete-trend-bar/);
  assert.match(source, /data-testid="athlete-stat-trend-details"/);
  assert.match(source, /trendGames = invite\.stats\?\.games/);
  assert.match(source, /Finalized only/);
});

test('public Athlete Hype Pages present direct videos in an accessible horizontal carousel', () => {
  assert.match(source, /data-testid="athlete-video-carousel"/);
  assert.match(source, /athlete-highlights-panel/);
  assert.match(source, /athlete-video-stage/);
  assert.match(source, /data-testid="athlete-video-reflection"/);
  assert.match(source, /href="#athlete-reply-composer"/);
  assert.match(source, /Send some hype/);
  assert.match(source, /data-testid="button-send-hype-for-video"/);
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
  assert.match(source, /w-\[82%\][\s\S]*?sm:w-\[58%\][\s\S]*?lg:w-\[50%\]/);
  assert.doesNotMatch(source, /invite\.videos\.length === 1 \? 'w-full'/);
  assert.match(source, /event\.key === 'ArrowLeft'/);
  assert.match(source, /event\.key === 'ArrowRight'/);
  assert.match(source, /if \(event\.target !== event\.currentTarget\) return/);
  assert.match(source, /aria-label="Previous video"/);
  assert.match(source, /aria-label="Next video"/);
  assert.match(source, /data-testid="athlete-video-empty-state"/);
  assert.doesNotMatch(source, /data-testid="athlete-image-hype-card"/);
  assert.doesNotMatch(source, /Open image Hype Card/);
});
