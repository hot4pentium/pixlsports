import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./athlete-invite.tsx', import.meta.url), 'utf8');
const athleteDraftSource = readFileSync(new URL('./athlete-video-draft.ts', import.meta.url), 'utf8');
const hypeCardSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const apiSource = readFileSync(new URL('../../../api-server/src/routes/hypeCardShares.ts', import.meta.url), 'utf8');
const athleteApiSource = readFileSync(new URL('../../../api-server/src/routes/athleteInvites.ts', import.meta.url), 'utf8');
const livingCardSource = readFileSync(new URL('./living-athlete-card.tsx', import.meta.url), 'utf8');

test('fan Shoutouts keep owner-only privacy wording distinct from media replies', () => {
  assert.match(livingCardSource, /Send a Shoutout/);
  assert.match(livingCardSource, /Only the card owner can read your message/);
  assert.match(livingCardSource, /Your shoutout could not be sent/);
  assert.match(source, /Fan Shoutouts/);
  assert.match(source, /Leave a reply/);
});
const livingCardStyles = readFileSync(new URL('./living-athlete-card.css', import.meta.url), 'utf8');
const publicPageSource = source.slice(source.indexOf('export function PublicAthleteInvitePage'));

test('the HYPE Card Videos side excludes photos inherited from older shares', () => {
  const videosSide = livingCardSource.slice(
    livingCardSource.indexOf("{side === 'videos' && ("),
    livingCardSource.indexOf('<div className="living-card-controls"'),
  );
  assert.doesNotMatch(videosSide, /invite\.hypeCard|living-card-image-highlight/);
  assert.match(videosSide, /recentVideos\.length > 0/);
  assert.match(videosSide, /Moments on the way/);
  assert.match(publicPageSource, /invite\.hypeCard\?\.posterUrl/, 'the separate Athlete Hype Page still supports its image shares');
});

test('public Athlete Hype Pages keep replies on-page and update recent reactions after sending', () => {
  assert.match(source, /HypeCardReplyComposer/);
  assert.match(source, /Choose a reaction and add an optional message for the latest shared video without leaving this athlete page/);
  assert.match(source, /shareToken=\{invite\.videos\[0\]\.shareToken\}/);
  assert.match(source, /setLocalReplies/);
  assert.doesNotMatch(source, /Send your own reply →/);
});

test('the HYPE Card manager retires the legacy editor route', () => {
  assert.match(
    hypeCardSource,
    /const athleteHypePage = athleteInvites\?\.\[0\] \?\? null;/,
  );
  assert.match(
    hypeCardSource,
    /await queryClient\.invalidateQueries\(\{ queryKey: getListHypeCardSharesQueryKey\(\) \}\);[\s\S]*?if \(!isStatsOnly && !linkedExport\) \{[\s\S]*?setLocation\(athleteHypePage \? `\/fan\/\$\{athleteHypePage\.inviteToken\}` : '\/studio\/athlete-page'\);/,
  );
  assert.match(
    hypeCardSource,
    /athleteHypePage && \(athleteHypePage\.paused \|\| !athleteHypePage\.showHypeCard\)[\s\S]*?showHypeCard: true,[\s\S]*?paused: false,/,
  );
  assert.match(
    hypeCardSource,
    /if \(linkedExport\) await handleExport\(url\);\s*if \(!isStatsOnly && !linkedExport\)/,
  );
  assert.doesNotMatch(source, /Hype Card editor|studio\/hype-card/);
  assert.doesNotMatch(appSource, /path="\/studio\/hype-card(?:\/:id)?"|import\(['"]@\/features\/hype-card['"]\)/);
  assert.match(appSource, /slug: 'athlete-page'/);
  assert.match(source, /href=\{`\/player\/\$\{existing\.inviteToken\}\/manage`\}/);
  assert.match(source, /href=\{`\/fan\/\$\{existing\.inviteToken\}`\}/);
  assert.match(source, /value=\{fanCardUrl\(invite\.inviteToken\)\}/);
  assert.match(appSource, /path="\/fan\/:inviteToken" component=\{LivingAthleteCardRoute\}/);
  assert.match(appSource, /path="\/player\/:inviteToken" component=\{LegacyAthleteInviteRedirect\}/);
  assert.match(source, /\{!existing && \(/);
  assert.match(source, /Create the HYPE Card/);
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
  assert.match(source, /window\.location\.hash !== '#owner-fan-hypes'/);
  assert.match(source, /target\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  assert.match(source, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /redirect_url=\$\{encodeURIComponent\(redirectUrl\)\}/);
  assert.match(source, /#owner-fan-hypes/);
  assert.match(source, /When browser alerts are enabled, new Shoutouts open directly here/);
  assert.match(source, /function OwnerVideoUpload/);
  assert.match(source, /Add a video here/);
  assert.match(source, /data-testid="section-manage-athlete-videos"/);
  assert.match(source, /prepareHypeCardShareMedia/);
  assert.match(source, /requestHypeCardShareUploadUrl/);
  assert.match(source, /expiresInDays: 365/);
  assert.match(source, /The original video remains on this device/);
  assert.match(source, /saveAthleteVideoDraft\(draftKey, \{ \.\.\.draft, blob: sourceBlob \}\)/);
  assert.match(source, /saveAthleteVideoDraftDetails\(draftKey, draft\)/);
  assert.match(source, /loadAthleteVideoDraft\(draftKey\)/);
  assert.match(source, /new File\(\[draft\.blob\], draft\.fileName/);
  assert.match(source, /setTrimStart\(draft\.trimStart\)/);
  assert.match(source, /setTrimEnd\(draft\.trimEnd\)/);
  assert.match(source, /setMediaName\(draft\.mediaName\)/);
  assert.match(source, /This video draft could not be saved on this device/);
  assert.match(source, /Only the prepared clip and poster are uploaded when you post/);
  assert.match(source, /await deleteAthleteVideoDraft\(draftKey\)/);
  assert.match(athleteDraftSource, /indexedDB\.open\(ATHLETE_VIDEO_DRAFT_DB, 1\)/);
  assert.match(athleteDraftSource, /blob: Blob/);
  assert.match(athleteDraftSource, /ATHLETE_VIDEO_DRAFT_SOURCE_STORE = 'sources'/);
  assert.match(athleteDraftSource, /ATHLETE_VIDEO_DRAFT_DETAILS_STORE = 'details'/);
  assert.match(athleteDraftSource, /export function saveAthleteVideoDraft/);
  assert.match(athleteDraftSource, /export async function loadAthleteVideoDraft/);
  assert.match(athleteDraftSource, /export async function deleteAthleteVideoDraft/);
  const prepareIndex = source.indexOf('const prepared = await prepareHypeCardShareMedia(');
  const uploadIndex = source.indexOf('requestHypeCardShareUploadUrl(', prepareIndex);
  const shareIndex = source.indexOf('await createShare.mutateAsync(', uploadIndex);
  assert.ok(prepareIndex >= 0 && uploadIndex > prepareIndex && shareIndex > uploadIndex);
  assert.ok(
    source.indexOf('setFile(null)', shareIndex) > shareIndex,
    'the selected original is cleared only after the share is created',
  );
  assert.match(source, /setProgress\(0\.01\)/);
  assert.match(source, /monotonicProgress\(current, value \* 0\.55\)/);
  assert.match(source, /onAudioCheck: \(\) => \{[\s\S]*?Checking audio before posting/);
  assert.match(source, /data-testid="hosted-video-title"/);
  assert.match(source, /data-testid="button-download-hosted-video"/);
  assert.match(source, /data-testid="button-remove-hosted-video"/);
  assert.match(source, /data-testid="hosted-image-hype-card"/);
  assert.match(source, /getListHypeCardSharesQueryKey\(hostedImageQuery\)/);
  assert.match(source, /data-testid="input-fan-hype-card-url"/);
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
  assert.match(source, /value=\{fanCardUrl\(invite\.inviteToken\)\}/);
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

test('Athlete Hype Pages cap active highlight videos at three', () => {
  assert.match(source, /const MAX_ATHLETE_HIGHLIGHT_VIDEOS = 3/);
  assert.match(source, /hostedVideos\.length >= MAX_ATHLETE_HIGHLIGHT_VIDEOS/);
  assert.match(source, /hostedVideos\.length\} \/ \{MAX_ATHLETE_HIGHLIGHT_VIDEOS\}/);
  assert.match(source, /Shows up to 3 active videos, newest first/);
  assert.match(apiSource, /const MAX_ACTIVE_HYPE_PAGE_VIDEOS = 3/);
  assert.match(apiSource, /pg_advisory_xact_lock\(hashtext\(/);
  assert.match(apiSource, /activeVideos\?\.total \?\? 0\) >= MAX_ACTIVE_HYPE_PAGE_VIDEOS/);
  assert.match(apiSource, /HYPE_PAGE_VIDEO_LIMIT/);
  assert.match(athleteApiSource, /\.limit\(maxHighlightVideos\)/);
});

test('shared card omits the intro headline while keeping the owner manage link', () => {
  const introIndex = livingCardSource.indexOf('className="living-card-intro"');
  const manageIndex = livingCardSource.indexOf('data-testid="link-manage-living-card"');
  const layoutIndex = livingCardSource.indexOf('className="living-card-layout living-card-layout-solo"');
  assert.ok(introIndex >= 0 && manageIndex > introIndex && manageIndex < layoutIndex);
  assert.match(livingCardSource, /\{ownerInvite && \(\s*<div className="living-card-intro">\s*<Link className="living-card-manage"/);
  assert.match(livingCardSource, /<span>Manage this athletic card<\/span><ArrowRight aria-hidden="true" \/>/);
  assert.match(livingCardSource, /aria-label=\{`\$\{invite\.athleteName\}'s HYPE Card`\}/);
  assert.doesNotMatch(livingCardSource, /One card\.|Every chapter\./);
  assert.match(livingCardStyles, /\.living-card-manage \{[^}]*flex-wrap: nowrap/);
  assert.doesNotMatch(livingCardSource, /The same athlete, a new story after every game\. Keep this link close\./);
  assert.doesNotMatch(
    livingCardSource,
    /className="living-card-story"[\s\S]*?data-testid="link-manage-living-card"/,
  );
});

test('athlete pages retire schedule content and force retired API fields off', () => {
  assert.match(source, /scheduleProjectId: null/);
  assert.match(source, /showSchedule: false/);
  assert.doesNotMatch(source, /scheduleProjects|Upcoming schedule|scheduleEvents|Add to Calendar|Schedule time zone/);
  assert.doesNotMatch(livingCardSource, /scheduleEvents|living-card-schedule|Add to calendar|scheduled-event alerts/);
});

test('public Athlete Hype Pages present direct videos in an accessible horizontal carousel', () => {
  assert.match(source, /data-testid="athlete-video-carousel"/);
  assert.match(source, /athlete-highlights-panel/);
  assert.match(source, /athlete-video-stage/);
  assert.match(source, /data-testid="athlete-video-reflection"/);
  assert.match(source, /href="#athlete-reply-composer"/);
  assert.match(source, /Leave a reply/);
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
