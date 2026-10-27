import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getHypeCardBackNavigation } from './hype-card-back-navigation';
import { resolveHypeCardAthleteName } from './hype-card-appearance';

const source = readFileSync(new URL('./athlete-invite.tsx', import.meta.url), 'utf8');
const athleteDraftSource = readFileSync(new URL('./athlete-video-draft.ts', import.meta.url), 'utf8');
const hypeCardSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const apiSource = readFileSync(new URL('../../../api-server/src/routes/hypeCardShares.ts', import.meta.url), 'utf8');
const athleteApiSource = readFileSync(new URL('../../../api-server/src/routes/athleteInvites.ts', import.meta.url), 'utf8');
const livingCardSource = readFileSync(new URL('./living-athlete-card.tsx', import.meta.url), 'utf8');
const eventNotificationsSource = readFileSync(new URL('./owner-event-notifications.tsx', import.meta.url), 'utf8');
const supporterDashboardSource = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
const showcaseSource = readFileSync(new URL('./player-showcase.tsx', import.meta.url), 'utf8');
const livingControlsSource = readFileSync(new URL('./living-card-controls.tsx', import.meta.url), 'utf8');

// Execute the actual identity declarations/effect without importing Vite assets,
// Clerk, or the page's unrelated UI. AST selection ignores whitespace/formatting.
const livingCardAst = ts.createSourceFile('living-athlete-card.tsx', livingCardSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNodes(predicate: (node: ts.Node) => boolean, ast: ts.SourceFile = livingCardAst) {
  const matches: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return matches;
}

async function runProfileSync({
  embedded = false, ownedInvites = [], profileName = ' Current Athlete ', pending = false,
  fail = false,
}: {
  embedded?: boolean; ownedInvites?: Array<Record<string, unknown>>;
  profileName?: string; pending?: boolean; fail?: boolean;
} = {}) {
  const declarations = ['ownerInvite', 'profileAthleteName', 'displayAthleteName', 'profileNameSyncKey']
    .map((name) => {
      const matches = findNodes((node) => ts.isVariableDeclaration(node) && node.name.getText(livingCardAst) === name);
      assert.equal(matches.length, 1, `identity declaration ${name} exists once`);
      return `const ${matches[0].getText(livingCardAst)};`;
    });
  const effects = findNodes((node) => ts.isCallExpression(node)
    && node.expression.getText(livingCardAst) === 'useEffect'
    && node.arguments[0]?.getText(livingCardAst).includes('updateInvite.mutateAsync'));
  assert.equal(effects.length, 1, 'one owner profile synchronization effect');
  const writes: Array<{ inviteToken: string; data: Record<string, unknown> }> = [];
  const invalidations: unknown[] = [];
  const errors: boolean[] = [];
  const context = {
    embedded, ownedInvites, inviteToken: 'shared-athlete',
    invite: { athleteName: 'Published Athlete' },
    profile: { athleteName: profileName }, resolveHypeCardAthleteName,
    profileNameSyncAttemptRef: { current: '' },
    setProfileNameSyncError: (error: boolean) => errors.push(error),
    updateInvite: {
      isPending: pending,
      mutateAsync: async (input: (typeof writes)[number]) => {
        writes.push(input);
        if (fail) throw new Error('Save failed');
      },
    },
    queryClient: { invalidateQueries: async (input: unknown) => { invalidations.push(structuredClone(input)); } },
    getListAthleteInvitesQueryKey: () => ['owned-invites'],
    getGetAthleteFanCardQueryKey: (token: string) => ['fan-card', token],
  };
  const script = ts.transpileModule([
    ...declarations,
    `const sync = ${(effects[0] as ts.CallExpression).arguments[0].getText(livingCardAst)};`,
    'sync(); sync(); ({ displayAthleteName });',
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = runInNewContext(script, context) as { displayAthleteName: string };
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { ...result, writes, invalidations, errors };
}

test('HYPE Card creation directs athlete photo uploads to its manager, not Athlete Profile', () => {
  assert.match(source, /data-testid="first-card-photo-guidance"/);
  assert.match(source, /After creating your HYPE Card, open Manage HYPE Card to upload the athlete’s photo/);
  assert.doesNotMatch(source, /link-first-card-athlete-photo|Upload athlete photo in Athlete Profile/);
  assert.match(source, /title="Upload Photo"/);
  assert.match(source, /<FanCardPhotoManager inviteToken=\{invite\.inviteToken\}/);
  assert.doesNotMatch(supporterDashboardSource, /input-athlete-photo|Athlete Photo/);
  assert.doesNotMatch(appSource, /useRequestSupporterPhotoUploadUrl|useSaveSupporterPhoto|useCachedSupporterPhoto/);
});

test('HYPE Card create button is inside its create section', () => {
  assert.match(
    source,
    /data-testid="form-create-hype-card"[\s\S]*?data-testid="card-create-hype-page"[\s\S]*?data-testid="button-create-hype-card"[\s\S]*?Create HYPE Card[\s\S]*?<\/form>/,
  );
  assert.doesNotMatch(source, /className="mt-8 max-w-xl"/);
});

test('Player Showcase HYPE Card back actions use consistent Player Showcase naming', () => {
  for (const testId of [
    'link-management-sign-in-athlete',
    'link-management-unavailable-athlete',
    'link-back-to-dynamic-showcase',
  ]) {
    assert.match(
      source,
      new RegExp(`<BackNavigationLink href="/studio/player-showcase" label="Back to Player Showcase" testId="${testId}"`),
      `${testId} should return to Player Showcase`,
    );
  }
  const ownerManagementStart = source.indexOf('data-testid="owner-athlete-invite-management-page"');
  const ownerManagementEnd = source.indexOf('export function PublicAthleteInvitePage', ownerManagementStart);
  const ownerManagementRoute = source.slice(ownerManagementStart, ownerManagementEnd);
  assert.equal((ownerManagementRoute.match(/<BackNavigationLink/g) ?? []).length, 1, 'the owner HYPE Card Manager has one back button');
  assert.match(ownerManagementRoute, /testId="link-back-to-dynamic-showcase"/);
  assert.doesNotMatch(ownerManagementRoute, /link-hype-manager-studio/);
  assert.match(
    hypeCardSource,
    /href=\{athleteRestricted \? '\/studio\/player-showcase' : '\/studio'\} label=\{athleteRestricted \? 'Back to Player Showcase' : 'Back to studio'\}/,
    'the athlete-restricted card editor returns to Player Showcase',
  );
});

test('HYPE Card back navigation distinguishes owner Showcase from public Showcase', () => {
  assert.equal(getHypeCardBackNavigation('athlete/token', true).href, '/studio/player-showcase');
  assert.equal(getHypeCardBackNavigation('athlete/token', false).href, '/showcase/athlete%2Ftoken');
  assert.equal(getHypeCardBackNavigation('athlete/token', false, '?from=player-showcase').href, '/studio/player-showcase');
  assert.match(showcaseSource, /cardPublicHref=[^\n]*\?from=player-showcase/);
  assert.match(
    livingCardSource,
    /<BackNavigationLink \{\.\.\.backNavigation\} variant="public"/,
  );
  assert.match(livingCardSource, /const backNavigation = getHypeCardBackNavigation\(/);
  assert.equal((livingCardSource.match(/<Shell inviteToken=\{inviteToken\} embedded=\{embedded\} ownerView=\{Boolean\(isSignedIn && ownerInvite\)\}>/g) ?? []).length, 3,
    'loaded, loading, and unavailable cards all preserve the owner return destination');
  assert.match(appSource, /path="\/showcase\/:inviteToken" component=\{PublicPlayerShowcasePage\}/);
});

test('HYPE Card sharing copy does not call links or pages stable', () => {
  assert.doesNotMatch(
    [source, hypeCardSource, appSource, supporterDashboardSource].join('\n'),
    /\bstable\b/i,
  );
});

test('HYPE Card events use one persistent all-or-none setting', () => {
  assert.match(source, /title="Event Notifications"/);
  assert.match(source, /label="Allow events"/);
  assert.match(source, /saveVisibilityChange\('showEvents', value\)/);
  assert.match(source, /including cards you create later/);
  assert.match(source, /OwnerEventNotifications/);
  const visibleSectionsStart = source.indexOf('data-testid="section-visible-athlete-page"');
  const visibleSectionsEnd = source.indexOf('</HypeManagerTaskCard>', visibleSectionsStart);
  const allowEventsToggle = source.indexOf('label="Allow events"', visibleSectionsStart);
  assert.ok(allowEventsToggle > visibleSectionsStart && allowEventsToggle < visibleSectionsEnd, 'event visibility belongs in the Visible Sections card');
  assert.doesNotMatch(source, /OwnerEventLinks|Link game days/);
  assert.match(athleteApiSource, /async function availableAthleteEvents/);
  assert.match(athleteApiSource, /invite\.showEvents \? availableAthleteEvents\(invite\) : Promise\.resolve\(\[\]\)/);
  assert.match(livingCardSource, /The card owner has turned off event sharing/);
  assert.match(livingCardSource, /All eligible Event Cards saved by/);
  assert.match(eventNotificationsSource, /Turn on “Allow events” in Visible Sections/);
});

test('HYPE Card event details do not repeat the full Game On Card link', () => {
  const eventsStart = livingCardSource.indexOf("{side === 'events' && (");
  const controlsStart = livingCardSource.indexOf('<LivingCardControls', eventsStart);
  const eventsSide = livingCardSource.slice(eventsStart, controlsStart);
  assert.match(eventsSide, /All eligible Event Cards saved by/);
  assert.doesNotMatch(eventsSide, /Full Event Card|gameOnHref|link-living-event-/);
  assert.doesNotMatch(eventsSide, /Open one for its full details/);
});

test('new fan Shoutouts require public disclosure while older private responses stay owner-only', () => {
  assert.match(livingCardSource, /Send a Shoutout/);
  assert.match(livingCardSource, /Your emoji and message will appear publicly on this card/);
  assert.match(livingCardSource, /I understand my emoji and message will be visible to everyone/);
  assert.match(livingCardSource, /publiclyVisible: true/);
  assert.match(livingCardSource, /Names stay private; older owner-only messages are not shown to other viewers/);
  assert.match(livingCardSource, /useListPublicAthleteInviteHypes/);
  assert.match(livingCardSource, /useListAthleteInviteHypes/);
  assert.match(livingCardSource, /ownerInvite && 'publiclyVisible' in item/);
  assert.match(livingCardSource, /Your shoutout could not be sent/);
  assert.match(source, /Fan Shoutouts/);
  assert.match(source, /Leave a reply/);
});
test('real Hype Card uses shared side controls below the card and retains private actions', () => {
  assert.match(livingCardSource, /import \{ LivingCardControls,[^}]*\} from '\.\/living-card-controls'/);
  assert.doesNotMatch(livingCardSource, /controlsBelowCard/);
  assert.match(livingCardSource, /<div className="living-card-frame-outer">[\s\S]*?<\/div>\s*<LivingCardControls/);
  for (const side of ['responses', 'stats', 'live-taps', 'events']) {
    assert.ok(livingControlsSource.includes(`button-living-card-${side}`), `${side} remains available`);
  }
  assert.match(livingControlsSource, /onSelectSide\?\.\(control\.side\)/);
  assert.match(livingControlsSource, /aria-pressed=\{side === control\.side\}/);
  assert.match(livingCardSource, /data-testid="button-living-card-front"/);
  assert.match(livingCardSource, /data-design=\{cardAppearance\.design\}/);
  assert.match(livingCardSource, /living-card-responses-side/);
  assert.match(livingCardSource, /living-card-live-taps-side/);
  assert.match(livingCardSource, /family-link-required/);
  assert.match(livingCardSource, /The public HYPE Card link is view-only/);
  assert.match(livingCardSource, /ownerInvite && <button/);
  assert.match(livingCardSource, /onClick=\{\(\) => void removeShoutout\(item\.id\)\}/);
  assert.match(livingCardSource, /window\.confirm\('Remove this Shoutout/);
});

test('family Live Taps access is shown as a private QR code, not a shareable link', () => {
  assert.match(source, /import QRCode from 'qrcode'/);
  assert.match(source, /QRCode\.toDataURL\(accessUrl,[\s\S]*?errorCorrectionLevel: 'Q'/);
  assert.match(source, /data-testid="button-create-live-tap-qr"/);
  assert.match(source, /data-testid="img-created-live-tap-qr"/);
  assert.match(source, /button-revoke-live-tap-qr-\$\{link\.id\}/);
  assert.doesNotMatch(source, /input-created-live-tap-link|button-copy-live-tap-link|Copy link/);
  assert.match(livingCardSource, /scan the private family QR code/);
  assert.match(livingCardSource, /The public HYPE Card link is view-only/);
  assert.match(livingCardSource, /family QR code is invalid or has been revoked/);
});

test('the HYPE Page manager explains public link access and temporary hiding', () => {
  assert.match(source, /title="Public HYPE Page" description="Page link and visibility"/);
  assert.match(source, /Anyone with this link can open the page/);
  assert.match(source, /Family Live Taps uses a separate private QR code/);
  assert.match(source, /HIDDEN FROM FANS/);
  assert.match(source, /same link is kept; make it public again whenever you are ready/);
  assert.match(source, /Hiding the page also ends any active Game Day Live session/);
  assert.match(source, /PUBLIC TO ANYONE WITH THIS LINK/);
  assert.match(source, /Hide public page/);
  assert.match(source, /Make page public again/);
});

const livingCardStyles = readFileSync(new URL('./living-athlete-card.css', import.meta.url), 'utf8');
const publicPageSource = source.slice(source.indexOf('export function PublicAthleteInvitePage'));

test('the real HYPE Card flips paired 3D faces and respects reduced motion', () => {
  assert.match(livingCardSource, /className="living-card-frame" data-side=\{side\}/);
  assert.match(livingCardSource, /className="living-card-flip-inner"/);
  assert.match(livingCardSource, /living-card-flip-face living-card-flip-front/);
  assert.match(livingCardSource, /living-card-flip-face living-card-flip-back/);
  assert.match(livingCardStyles, /transform-style:\s*preserve-3d/);
  assert.match(livingCardStyles, /\.living-card-flip-back\s*\{\s*-webkit-transform:\s*rotateY\(180deg\);\s*transform:\s*rotateY\(180deg\)/);
  assert.match(livingCardStyles, /backface-visibility:\s*hidden/);
  assert.match(livingCardStyles, /\.living-card-frame:not\(\[data-side="front"\]\).*rotateY\(180deg\)/);
  assert.match(livingCardStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(livingCardStyles, /@supports not \(transform-style: preserve-3d\)/);
  assert.match(livingCardStyles, /\.living-card-frame\[data-side="front"\]\s+\.living-card-flip-front\s*\{\s*display:\s*block/);
  assert.match(livingCardStyles, /\.living-card-frame:not\(\[data-side="front"\]\)\s+\.living-card-flip-back\s*\{\s*display:\s*block/);
});

test('desktop HYPE Cards are taller with a smaller athlete name while mobile sizing stays intact', () => {
  assert.match(livingCardStyles, /@media \(min-width: 801px\)\s*\{\s*\.living-card-frame\s*\{\s*height:\s*min\(72dvh,\s*920px\);\s*\}\s*\.living-card-athlete-name\s*\{\s*font-size:\s*clamp\(44px,\s*5vw,\s*68px\);\s*\}\s*\}/);
  assert.match(livingCardStyles, /@media \(max-width: 520px\)[\s\S]*?\.living-card-frame\s*\{\s*min-height:\s*540px;\s*height:\s*144vw;\s*max-height:\s*700px;\s*\}/);
});

test('the HYPE Card no longer exposes a Videos side', () => {
  assert.doesNotMatch(livingCardSource, /side === 'videos'|button-living-card-videos|video-living-card/);
  assert.match(publicPageSource, /invite\.hypeCard\?\.posterUrl/, 'the separate Athlete Hype Page still supports its image shares');
});

test('public Athlete Hype Pages do not expose video reply controls', () => {
  assert.match(source, /\{false && invite\?\.videos\[0\] && \(/);
  assert.match(source, /setLocalReplies/);
  assert.doesNotMatch(source, /Send your own reply →/);
});

test('the HYPE Card manager preserves the public page path and protected studio editor', () => {
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
  assert.doesNotMatch(publicPageSource, /studio\/hype-card/, 'public pages do not expose the protected editor');
  assert.match(
    appSource,
    /<Route path="\/studio\/hype-card\/:id\?"><ProtectedEditor kind="hype"><HypeCardEditor \/><\/ProtectedEditor><\/Route>/,
  );
  assert.match(appSource, /slug: 'athlete-page'/);
  assert.match(source, /href=\{`\/player\/\$\{existing\.inviteToken\}\/manage`\}/);
  assert.match(source, /href=\{`\/fan\/\$\{existing\.inviteToken\}`\}/);
  assert.match(source, /value=\{fanCardUrl\(invite\.inviteToken\)\}/);
  assert.match(appSource, /path="\/fan\/:inviteToken" component=\{LivingAthleteCardRoute\}/);
  assert.match(appSource, /path="\/player\/:inviteToken" component=\{LegacyAthleteInviteRedirect\}/);
  const inviteAst = ts.createSourceFile('athlete-invite.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const createBranch = findNodes((node) => ts.isConditionalExpression(node)
    && node.condition.getText(inviteAst) === 'existing'
    && node.whenFalse.getText(inviteAst).includes('form-create-hype-card'), inviteAst);
  assert.equal(createBranch.length, 1, 'creation is offered only when no existing card is present');
  assert.ok((createBranch[0] as ts.ConditionalExpression).whenTrue.getText(inviteAst).includes('link-manage-athlete-card'),
    'existing cards lead to management instead of creating duplicates');
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
  assert.match(source, /<OwnerHypePageManage invite=\{ownerInvite\} profile=\{profile\} \/>/);
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
  assert.doesNotMatch(source, /Shows up to 3 active videos, newest first/);
  assert.match(apiSource, /const MAX_ACTIVE_HYPE_PAGE_VIDEOS = 3/);
  assert.match(apiSource, /pg_advisory_xact_lock\(hashtext\(/);
  assert.match(apiSource, /activeVideos\?\.total \?\? 0\) >= MAX_ACTIVE_HYPE_PAGE_VIDEOS/);
  assert.match(apiSource, /HYPE_PAGE_VIDEO_LIMIT/);
  assert.match(athleteApiSource, /\.limit\(maxHighlightVideos\)/);
});

test('shared card has no management banner; management stays in the owner Showcase', () => {
  assert.doesNotMatch(livingCardSource, /living-card-intro|link-manage-living-card|Manage this athletic card/);
  assert.match(showcaseSource, /cardEditHref=\{cardSettingsHref\}/);
  assert.match(showcaseSource, /\/player\/\$\{encodeURIComponent\(matchedInvite\.inviteToken\)\}\/manage#design/);
  assert.match(livingCardSource, /aria-label=\{`\$\{displayAthleteName\}'s HYPE Card`\}/);
  assert.doesNotMatch(livingCardSource, /One card\.|Every chapter\./);
  assert.doesNotMatch(livingCardSource, /The same athlete, a new story after every game\. Keep this link close\./);
});

const ownedInvite = {
  inviteToken: 'shared-athlete', athleteName: 'Previous Athlete',
  teamName: 'Team', seasonName: 'Season', seasonEndsAt: '2027-12-31',
  timezone: 'UTC', sport: 'soccer', trackerProjectId: 'private-tracker',
  showHypeCard: true, showStats: false, showEvents: false, hypesEnabled: false, paused: true,
};

test('verified owner profile synchronization preserves privacy settings and refreshes both readers', async () => {
  const result = await runProfileSync({ ownedInvites: [ownedInvite] });
  assert.equal(result.displayAthleteName, 'Current Athlete');
  assert.equal(result.writes.length, 1, 'repeated effects do not duplicate the write');
  assert.equal(result.writes[0].inviteToken, ownedInvite.inviteToken);
  assert.deepEqual({ ...result.writes[0].data }, {
    ...Object.fromEntries(Object.entries(ownedInvite).filter(([key]) => key !== 'inviteToken')),
    athleteName: 'Current Athlete', scheduleProjectId: null, showSchedule: false,
  });
  assert.deepEqual(result.invalidations, [
    { queryKey: ['owned-invites'] }, { queryKey: ['fan-card', 'shared-athlete'] },
  ]);
  assert.deepEqual(result.errors, [false]);
  assert.match(livingCardSource, /athleteName=\{displayAthleteName\}/);
});

test('public, other-owner, and embedded cards never use or save the viewer profile', async () => {
  for (const options of [
    {},
    { ownedInvites: [{ ...ownedInvite, inviteToken: 'another-athlete' }] },
    { ownedInvites: [ownedInvite], embedded: true },
  ]) {
    const result = await runProfileSync(options);
    assert.equal(result.displayAthleteName, 'Published Athlete');
    assert.deepEqual(result.writes, []);
    assert.deepEqual(result.invalidations, []);
  }
});

test('owner name synchronization skips blank, unchanged, and in-flight updates and surfaces failures', async () => {
  for (const options of [
    { profileName: '   ' },
    { profileName: ownedInvite.athleteName },
    { pending: true },
  ]) {
    assert.deepEqual((await runProfileSync({ ownedInvites: [ownedInvite], ...options })).writes, []);
  }
  const failed = await runProfileSync({ ownedInvites: [ownedInvite], fail: true });
  assert.deepEqual(failed.errors, [false, true]);
  assert.deepEqual(failed.invalidations, [], 'failed saves must not claim refreshed shared data');
});

test('athlete pages retire schedule content and force retired API fields off', () => {
  assert.match(source, /scheduleProjectId: null/);
  assert.match(source, /showSchedule: false/);
  assert.doesNotMatch(source, /scheduleProjects|Upcoming schedule|scheduleEvents|Add to Calendar|Schedule time zone/);
  assert.doesNotMatch(livingCardSource, /scheduleEvents|living-card-schedule|Add to calendar|scheduled-event alerts/);
});

test('public Athlete Hype Pages keep stored videos out of the rendered profile', () => {
  assert.match(source, /\{false && \(invite\?\.videos\.length \?\? 0\) > 0 \? \(/);
  assert.match(source, /data-testid="athlete-video-carousel"/);
  assert.match(source, /athlete-highlights-panel/);
  assert.match(source, /data-testid="athlete-video-empty-state"/);
  assert.match(source, /data-testid="athlete-image-highlight"/);
  assert.doesNotMatch(source, /data-testid="athlete-image-hype-card"/);
  assert.doesNotMatch(source, /Open image Hype Card/);
});
