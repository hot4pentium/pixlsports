# PIXL Sports native iPhone sign-in

This SwiftUI app uses the separate **PIXL Sports iOS** external Clerk app.
The web/Android PWA keeps its existing Replit-managed Clerk configuration.

## Account deletion notices

An accepted removal request stores a non-sensitive receipt on the device before
sign-out. The signed-out screen distinguishes the accepted request from completed
cleanup, and the receipt remains available after relaunch until dismissed.

The native cleanup job captures only a verified email from the native provider
before deleting that identity. After cleanup is committed, it sends completion
mail through the **Resend workspace API connection**, using the existing
`support@pixlsports.com` sender. Resend must be connected and that sending domain
verified before delivery can work. Email failures do not reopen account access.
The recipient is erased after provider acceptance, or seven days after cleanup.
Uncertain attempts older than the provider's idempotency window require review
rather than an automatic duplicate send. Legacy access-removal notices explicitly
state that the linked PWA account and data were preserved.
Never copy the PWA's Clerk keys into the iPhone app or put a Clerk secret key
in any native source, plist, or build setting.

## Setup on your Mac

1. Preserve any uncommitted Mac work before syncing source changes. Xcode package
   additions made on the Mac do not automatically appear in Replit, and Replit
   changes do not automatically appear in the Mac checkout. The project here now
   includes the same official package URL and both `ClerkKit` and `ClerkKitUI`.
   When reconciling project files, retain one Clerk package reference, not two.
2. Open `PIXL Sports.xcodeproj` in Xcode 26 or newer. Resolve Swift packages.
   This integration uses Clerk iOS **1.6.1 or newer within major version 1**,
   including its completed-auth-flow check.
3. Open `PIXL Sports/ClerkConfig.plist` in Xcode. Set **PublishableKey** to the
   **publishable** key from the dedicated **PIXL Sports iOS** app's development
   instance. It starts with `pk_test_`. This client key is designed to be bundled
   in the app; it is not a server secret. Do not paste it into chat. Never use
   `sk_test_` or `sk_live_` here.
4. Ensure the plist belongs to the app target / Copy Bundle Resources. The project
   uses a filesystem-synchronized app directory, so new files normally join the
   target automatically. If the app displays a missing-file setup message, check
   target membership rather than adding another copy.
5. The iOS Clerk app must have Native API enabled and an iOS entry with Bundle ID
   `com.pixlsports` and its verified Apple App ID Prefix.
6. Select an iPhone simulator and run. An empty/invalid configuration shows a setup
   message instead of crashing. A configured app shows Clerk's native `AuthView`.

## Apple capabilities still require separate setup

Adding a native app in Clerk does not enable Sign in with Apple by itself.
Follow Clerk's official native Apple guide to enable/configure Apple in the
**iOS Clerk app**, and add **Sign in with Apple** to the Xcode target.
Apple developer membership/signing requirements still apply.

For credential AutoFill and passkeys, add the **Associated Domains** capability
and `webcredentials:<iOS Clerk Frontend API hostname>` using the exact hostname
from this dedicated Clerk app. Do not include `https://` or a URL path.
Associated Domains is not the Sign in with Apple capability.
The app does not supply either Apple capability with a guessed team/prefix/domain.

## What is connected

- Clerk's native sign-in/sign-up/verification flows gate Supporter Home.
- Only a completed, active Clerk authentication flow can show the home screen.
- Clerk restores its device session; the app does not store passwords or tokens.
- Clerk's account button provides account management and sign-out.
- Slow/failed startup has an explicit retry, and malformed local config has a
  setup message. Configuration values are not logged or displayed.
- Supporter Home loads the linked owner's private Event Card schedule from
  `GET /api/native/supporter/schedule`. The API verifies the current native
  identity-to-web-owner link and rechecks the web account's lifecycle/editor
  restrictions on every request.
- The native schedule includes only Event Card details and tracker-derived
  live/final status. It does not return raw tracker data or depend on public
  HYPE Card visibility. The previous device-saved public athlete-page URL is
  no longer used by Supporter Home.
- Families can create Event Cards from the dashboard and edit an existing card
  from its detail screen. Each save checks the linked account and card owner on
  the server, then confirms the changed card through a fresh private schedule
  read. The existing web management and public Event Card link stay in place.
- Active game Event Cards can open the native Live Taps screen. Sending a cheer
  still requires scanning the owner’s private family QR; the public card link
  remains view-only. The iPhone uses the existing family-token tap endpoint,
  and Live Taps do not create stat-tracker plays or a separate history.

The signed-in iPhone UI test `testSignedInFansCanCheerWhileEventStatsStayLive`
uses `PIXL_TRACKING_TEST_EVENT_ID` to open a dedicated Event Card with an
editable live stats game and no existing Live Taps session. It starts Live Taps,
creates a family QR, sends one cheer through the granted fan controls, and
checks both scoreboard values remain unchanged. It revokes the QR it creates,
but leaves Live Taps active; use a disposable development Event Card and end or
reset that session before running the test again. Run it on a Mac with Xcode
after signing in and linking the development owner on the simulator:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testSignedInFansCanCheerWhileEventStatsStayLive
```

## Securely connect an existing PIXL account

The link button on native home starts a ten-minute, device-bound request. Sign in
to the existing PIXL web account at `/connect/iphone`, manually enter the code
from the app, review that account, and explicitly approve it. Return to the
iPhone, check the approving account label, and confirm. Approval alone never
creates a link. Both sides offer disconnect; neither account or its saved data
is deleted. Web users can also withdraw an approval before iPhone confirmation.

- The API's **NATIVE_IOS_CLERK_ISSUER** must be the exact HTTPS issuer/Frontend API
  origin of the dedicated external iOS Clerk instance. Development and production
  instances need separately configured issuers. This is not a secret key; the API
  downloads public signing keys only from this pinned origin.
- **NATIVE_LINK_WEB_ORIGIN** optionally pins the HTTPS web approval origin. By
  default, development uses Replit's runtime preview domain and production uses
  the verified published origin `https://pixlsports.com`. No trailing slash/path.
- Debug builds require a String **AccountLinkAPIOrigin** in the local
  `ClerkConfig.plist`, containing the HTTPS preview origin without a path.
  They never silently fall back to the published website. Release builds
  default to `https://pixlsports.com` when this setting is absent.
  Keep the existing publishable key. Codes and bearer tokens are never added
  to browser URLs.
- Apply the additive DB schema changes and publish the API/web changes before
  testing against the published site. No deployment is performed by adding code.

Missing issuer configuration fails closed with a setup error. Never trust the
issuer in an incoming JWT, match accounts by email, or replace the managed PWA
keys. Existing account IDs/data ownership remain unchanged.

**Not connected yet:** private Event Cards and QR-authorized Live Taps are the
current native data surfaces. Native stat editing and other account data are not
included. Every future private native read must resolve the verified mapping and
recheck current account lifecycle/editor restrictions; cached links or previously
loaded data are not access.

## Mac verification

This repository is edited on Linux, without Xcode or an iOS simulator. Build,
signing, and rendered native UI must be verified on the Mac.

The Event Card detail UI tests launch local fixtures without signing in or
requesting private data. The default fixture limits content to 320 points wide.
Tests check that the date, opponent, location, status, and native tool panel
remain reachable at the largest accessibility text size:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>'
```

### Fixed Event Details step bar

`SupporterEventDetailUITests` covers the **Event Details bottom bar**, not the
dashboard schedule tiles:

- 320-point portrait width at default and accessibility XXXL text sizes.
- Full-device width in both landscape directions and return to portrait at
  both text sizes. Run on a small iPhone simulator as well as a notched/home-
  indicator iPhone; a constrained 320-point fixture does not simulate device
  safe-area hardware.
- Full Prep, Track Stats, and Share accessibility labels; Apple's native
  text-clipping and hit-region audits scoped to the bar; nonoverlapping
  44-by-44-point minimum button frames; and enabled-button reachability.
- UIKit-measured safe-area containment for the bar and all buttons, a usable
  scroll viewport above it, moving event details with a stationary bar, and
  reachability of the final tool panel.
- Two-column date/time details at default text size versus single-column
  details at accessibility sizes.
- Practice at narrow and landscape XXXL sizes: Track Stats stays visible and
  disabled while Prep and Share still switch the shared panel.
- The recommended button's accessibility value is `Recommended next step`,
  including Prep → Track Stats → Share timeline changes in the existing draft
  test. Selecting another panel must not transfer that recommendation.

The layout tests retain screenshots in the Xcode test result for visual review.
Run just these new layout cases on a Mac:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testEventStepsAtNarrowDefaultWidth \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testEventStepsAtNarrowAccessibilityXXXLWidth \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testEventStepsInBothLandscapeDirectionsAndAfterReturningToPortrait \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testEventStepsInLandscapeAtAccessibilityXXXL \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testPracticeKeepsDisabledStatsReadableAtNarrowAndLandscapeAccessibilityXXXL
```

Debug-only `--event-detail-full-width` removes the 320-point fixture constraint;
`--event-detail-practice` changes its fictional event to a practice. Both require
`--ui-testing-event-detail` and leave private tools locked. A Debug-only,
noninteractive UIKit accessibility probe exposes the actual safe rectangle to
XCTest without changing layout. It is absent from normal launches and Release.

**Verification boundary:** these tests have not been compiled or run in the
Linux workspace, which has no Apple Xcode, Swift compiler, or iOS simulator.
Source checks are not native rendering verification. On a Mac, inspect the
retained screenshots for complete visible labels and enable VoiceOver to confirm
the spoken step name/recommendation and disabled-practice explanation. XCTest
checks the accessibility metadata, not audio output or actual VoiceOver focus.

The Prep draft regression uses both `--ui-testing-event-detail` and
`--ui-testing-prep-draft` in **Debug only**. A test entry link opens Event Details
with the real embedded Prep editor and shared workspace model using
fictional saved notes/checklist data, without configuring Clerk, reading pending
commands, or making private requests. Its clock control advances only the test
date; the unchanged 15-second Event Details TimelineView must deliver a tick
before the test sees a new recommendation. Other private editors stay locked
without Clerk, and the fixture cannot save. The ordinary detail fixture allows
panel selection but remains read-only and never exposes private editors.

Run the focused regression on a Mac with Xcode and an iPhone simulator:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testUnsavedPrepSurvivesTimelineRecommendationsAndBackgroundResume \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testReadOnlyDetailFixtureDoesNotExposePrivateEditorsWithoutClerk
```

This checks unsaved note text, a toggled saved task, and a newly added/toggled task
through Prep → Track Stats → Share guidance, switching away from and back to the
Prep panel, Home/foreground activation, canceling the Event Details discard dialog,
confirmed discard, and reopening the unchanged saved data.
Allow up to 25 seconds per timeline transition. Linux source checks or browser
tests do not verify SwiftUI navigation or iOS lifecycle behavior.

### Compact Prep with large iPhone text

Two local-fixture cases cover the first four long checklist labels at 320-point
width, at default and accessibility XXXL text sizes:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testCompactPrepLongLabelsAtNarrowDefaultWidth \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testCompactPrepLongLabelsAtNarrowAccessibilityXXXLWidth
```

These check each full label and readiness value, expanded row heights,
nonoverlapping hit areas, full control containment above the fixed step bar,
and Apple's text-clipping/hit-region audits for each visible task and the
**Manage full Prep** / **Back to Content** controls. Screenshots are retained
for every task and both navigation actions. The full editor changes a fifth
task and notes; returning to Content and reopening must preserve all edits
and keep Save enabled without making a save request.

`--prep-long-labels` only changes the Debug workspace used with both
`--ui-testing-event-detail` and `--ui-testing-prep-draft`. It omits the
timeline-only test diagnostics to preserve the normal Content viewport.
The existing timeline/draft fixture is unchanged without this argument.
Run these cases on a small iPhone simulator and inspect the retained
screenshots before release. They cannot be compiled or run in this Linux
workspace; source checks do not verify native rendering or VoiceOver speech.

### Signed-in quick Prep persistence

Two opt-in cases in `SupporterEventDetailUITests` use the **real native auth,
account link, workspace reads, save endpoint, and pending-command journal**:

- `testSignedInQuickPrepCheckoffPersistsAfterSavingAndReopening`
- `testSignedInQuickPrepLostResponseRetriesSameMutationAfterRelaunch`

Run only against a dedicated development account and disposable upcoming Event
Card. On the target iPhone simulator, launch the app normally, complete Clerk
sign-in, and link the development owner. Create an unchecked Prep item in the
card's first four tasks and ensure there are no pending commands. Keep the card upcoming
throughout the run. The installed Debug configuration must point at the
development API and its native Clerk tenant; no auth credentials are supplied
through launch arguments or test environment variables.

Set these **non-secret identifiers** in the Xcode scheme's **Test** environment
(not only the app's Run environment):

- `PIXL_PREP_TEST_EVENT_ID`: the upcoming card's event ID.
- `PIXL_PREP_TEST_ITEM_ID`: a saved task ID within its first four tasks.

Missing identifiers skip these opt-in tests. Once identifiers are supplied,
missing sign-in, linking, card, checklist, or server acknowledgement fails the
test rather than falling back to a fixture.

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testSignedInQuickPrepCheckoffPersistsAfterSavingAndReopening \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testSignedInQuickPrepLostResponseRetriesSameMutationAfterRelaunch
```

Each test changes one compact checklist task, presses Save, closes Event
Details, reopens the same card, and checks the fresh server state and readiness
count. It then restores and verifies the original task state. A failed test may
leave that dedicated task changed or a pending command: inspect/retry or discard
that command and reset the test item before rerunning.

The retry case adds `--prep-save-lost-response-once` together with
`--ui-testing-signed-in-prep`. This Debug-only hook sends the real authenticated
Prep command, lets the development server commit it, then discards the success
before the app acknowledges it. It is limited to a signed-in Prep mutation and
stores its one-shot marker against that account, Event Card, and mutation ID.
The test terminates and relaunches the app, confirms that the same pending
mutation returns, retries through the real API, and verifies the checkoff after
reopening. It never fabricates success, changes the API destination, bypasses
authorization, or affects Release. The no-Clerk draft fixture remains unable
to save.

**Execution boundary:** these signed-in cases require Apple Xcode, an iPhone
simulator, and the prepared development session/card. They have not been run in
this Linux workspace; adding the tests does not confirm a successful native run.

### Signed-in Event Card sharing

`SupporterEventDetailUITests` also contains real-session checks for the two
actions in the Event Details Share section:

- `testSignedInShareChoicesAtNarrowWidthAndAccessibilitySizes` checks the
  event-detail share sheet and selected athlete HYPE Card at default and
  accessibility XXXL text sizes.
- `testSignedInEventShareDraftContainsCompleteLongVenue` chooses Messages from
  the native share sheet and verifies the unsent draft contains the full event
  date, time, and exact long venue name.
- `testSignedInEventShareDraftWithoutVenueKeepsDateAndTime` chooses Messages
  from the native share sheet and verifies the unsent draft keeps the event date
  and time without an empty or previous-event location.
- `testSignedInReviewKeepsPrivateHypeCardUnpublished` checks that reviewing a
  private HYPE Card leaves it unavailable and does not expose a share action.

Use a dedicated development account already signed in and linked on the target
iPhone simulator. Set these non-secret values in the Xcode scheme's **Test**
environment:

- `PIXL_SHARE_TEST_EVENT_ID`: the upcoming Event Card's event ID.
- `PIXL_SHARE_TEST_ATHLETE_NAME`: the selected athlete's exact display name.
- `PIXL_SHARE_TEST_LOCATION`: the exact long venue name saved on that Event
  Card; use at least 40 characters so the test can catch truncation.
- `PIXL_SHARE_TEST_NO_VENUE_EVENT_ID`: a separate upcoming Event Card with no
  saved venue.
- `PIXL_SHARE_TEST_STALE_LOCATION`: a distinctive venue from another Event Card
  that must not appear in the no-venue draft.

Use an Event Card with a saved date, time, and non-empty location. The draft
test also needs the long venue configured above.
The no-venue test uses the separate card configured above; it confirms the
details view says “Location to be announced,” then checks that the Messages
draft still contains the full date and time but neither a `Location:` line nor
the configured stale venue. It confirms Send is disabled and cancels/deletes
the local draft without entering a recipient.
For the first test, the selected athlete's HYPE Card must be available to
supporters. For the private-card test, set that card to private/hidden before
running the test. The test uses the same read-only native lookup as the app; it
does not change card visibility or share the HYPE Card. Do not use a personal
or production account.

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testSignedInShareChoicesAtNarrowWidthAndAccessibilitySizes

xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testSignedInEventShareDraftContainsCompleteLongVenue

xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testSignedInEventShareDraftWithoutVenueKeepsDateAndTime

xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testSignedInReviewKeepsPrivateHypeCardUnpublished
```

The Debug-only `--ui-testing-share-narrow` argument constrains Event Details to
320 points; it does not replace Clerk authentication or use fixture data.
The tests verify that both Share actions remain reachable, that the native iOS
share sheet contains the event date, time, and location, and that the HYPE Card
destination matches the selected athlete. The draft test checks that Messages
receives the full date, time, and long venue in its draft body, confirms Send is
disabled because no recipient was selected, and cancels the draft without
sending it. Run on a small iPhone simulator and inspect the share sheet at both
text sizes. These device tests have not been compiled or run in this Linux
workspace.

`SupporterDashboardUITests` also checks the dashboard at 320 points: connected
empty, unlinked, loading, error, upcoming, and live states; large-text athlete
identity and connection controls; and Event Card navigation. Run just this suite:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterDashboardUITests
```

The same suite verifies the Fan Base offline state and retry recovery, then
checks that a failed refresh removes a previously loaded count. These cases use
a Debug-only fictional connectivity fixture and never access an account.

The dashboard suite also uses fictional fixed-time guide fixtures:
`guide-upcoming` is one minute before the Event Card begins in Los Angeles,
`guide-live` is its exact start, and `guide-postgame` is just over three hours
after it. These deliberately occur on November 13 in Los Angeles and November
14 in UTC. The tests check the guide label/date, both hero-card layouts at
normal and largest accessibility text sizes, and that each hero opens its
native destination. Run the suite above on an iPhone simulator before release.

For visual checks without signing in, temporarily add `--ui-testing-dashboard`,
`--dashboard-narrow`, and `--dashboard-state=empty` to the **Debug** scheme's
launch arguments. Other states are `unlinked`, `loading`, `error`, `upcoming`,
`live`, `guide-upcoming`, `guide-live`, and `guide-postgame`. These fixtures use
fictional data, skip Clerk configuration and all schedule requests, and open
only fictional destinations. They are excluded from Release builds. Remove the
arguments to return to the real signed-in app.

To preview the native launch screen without signing in, use
`--ui-testing-launch-splash`; use `--ui-testing-launch-splash-error` to inspect
its retry state. These Debug-only fixtures are visual checks and do not exercise
live Clerk restoration or schedule requests.

Debug connection screens show **Development API — installed app**, read from the
bundled plist rather than the Xcode editor. Connection failures include the HTTP
status and safe destination details, without tokens, keys, or raw response bodies.
When a connection fails, use those details to distinguish missing bundled config,
an old published endpoint, a blocked redirect, and an actual authentication error.

The endpoint configuration/diagnostic checks also run without Clerk or networking:

```sh
swiftc -parse-as-library "ios/PIXL Sports/NativeAccountLinkEndpoint.swift" \
  ios/Tests/NativeAccountLinkEndpointChecks.swift -o /tmp/pixl-link-endpoint-checks
/tmp/pixl-link-endpoint-checks
```

The Foundation-only configuration checks do not require Clerk or network access:

```sh
swiftc -parse-as-library "ios/PIXL Sports/NativeClerkConfiguration.swift" \
  ios/Tests/NativeClerkConfigurationChecks.swift -o /tmp/pixl-clerk-config-checks
/tmp/pixl-clerk-config-checks
```

The family QR parser has Foundation-only checks for the correct athlete link,
approved hosts, and token-in-fragment format:

```sh
swiftc -parse-as-library "ios/PIXL Sports/FamilyLiveTapQR.swift" \
  ios/Tests/FamilyLiveTapQRChecks.swift -o /tmp/pixl-live-tap-qr-checks
/tmp/pixl-live-tap-qr-checks
```

### Live Taps Apple release verification

Run from a Mac checkout with full **Xcode 26+** selected (`xcode-select -p`),
the iOS Simulator platform installed, and Swift package download access:

```sh
bash ios/Tests/verify-live-taps-apple.sh
```

The command first compiles and **executes** the Foundation receipt/celebration
checks with Apple Swift and assertions enabled, then builds the complete app for
a generic iOS Simulator with signing disabled. It exits unsuccessfully if either
step fails. Logs, source revision/working-tree status, build results and derived
data stay in ignored `generated-artifacts/native-live-taps-apple/`.
No login, real account, signing secret, deployment, or workflow push is required.
This is a documented local/approved-runner command, not a newly enabled CI job:
no existing CI configuration was present when this verification path was added.

Coverage includes Event Card IDs used as game IDs with opaque recipient
references, active/completed personal totals, legacy saved queues, retrying the
same UUID after a lost accepted response, persisted one-time celebration,
and audience isolation by account, account link and invite. Pending cheers retain
their original grant, game and mutation ID across persistence. These local
models do **not** prove that a revoked grant is rejected by the server.
Server authorization and UUID deduplication remain unchanged.

**Verification evidence:** The downloaded verification project was run on the
user's Mac on November 4, 2026 (November 5 UTC). Its supplied terminal tail shows
`BUILD SUCCEEDED` and `PASS: unsigned iOS Simulator app build.` Since the script
uses fail-fast execution and runs the Foundation executable before invoking
`xcodebuild`, successful script completion also indicates the preceding Foundation
compile and execution succeeded. The earlier Foundation PASS line and tool
versions are not present in the supplied tail; see the
[evidence summary](Tests/native-live-taps-apple-verification.md) for that limit.
Future release runs should retain the complete log with both PASS lines.
The focused [device checklist](Tests/native-cheer-celebration-device-checks.md)
separately covers real iPhone persistence, VoiceOver and offline radio behavior;
a simulator build does not mark those checks passed.

The schedule-refresh policy checks that navigation, stat saves, and Prep saves
do not announce schedule changes, while event mutations route to the views that
need updated data:

```sh
swiftc -parse-as-library "ios/PIXL Sports/NativeEventScheduleRefreshPolicy.swift" \
  ios/Tests/NativeEventScheduleRefreshChecks.swift -o /tmp/pixl-schedule-refresh-checks
/tmp/pixl-schedule-refresh-checks
```

The XCTest UI coverage verifies that changing Event Details tools leaves its
load count unchanged, and that game start, game finish, Live Taps start, and
Event Card edits refresh the expected views once. It uses fictional dashboard
data and Debug-only controls; it does not sign in or mutate a real Event Card.
Run the focused cases on a Mac with Xcode:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>' \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testStepButtonsSwitchTheSharedPanelWithoutLeavingEventDetails \
  -only-testing:PIXL\ SportsUITests/SupporterEventDetailUITests/testEventChangesRefreshEventDetailsExactlyOnceAndDashboardAfterClosing
```

After syncing code and configuring the publishable key:

1. Build for an iPhone simulator; confirm only one Clerk package is linked.
2. With the key empty or malformed, confirm the setup message appears.
3. With the iOS development key, complete native sign-up/sign-in and verification.
   Verify any MFA/session tasks finish before home appears.
4. Tap the account button, sign out, and confirm home is removed.
5. Sign in, relaunch, and confirm session restoration.
6. Disable networking before cold launch, wait for the retry state, restore
   networking, and retry. Clerk itself may be able to restore cached state.
7. Test Sign in with Apple separately after provider/capability configuration.
8. Tap the link button, approve a code on the web, and verify nothing connects
   until the iPhone explicitly confirms the displayed web account.
9. Disconnect from each side; relaunch and verify the removed link stays removed.
   Also test denial, expiration, web approval withdrawal, offline retry,
   backgrounding during approval, and switching native accounts mid-flow.

### First-time iPhone signup

New users sign in through the native Clerk UI, then enter their athlete's name
and sport. Team, jersey number, and position are optional and remain editable in
Settings. Saving setup assigns a private, paused starter HYPE Card; nothing is
published automatically. A PWA visit is not required.

The API uses the server-side Clerk workspace connector for the dedicated iOS
instance. Its public signing keys must match `NATIVE_IOS_CLERK_ISSUER`.
Keep the iOS secret out of Xcode and leave the PWA's managed keys unchanged.
New iPhone signups receive independent database-backed profiles in
`native_accounts`, with owners namespaced by the verified issuer and subject.
The server does not create a PWA Clerk user, copy a PWA profile, or select an
account by email—even when the same email was used in the PWA. Profile metadata
and the private starter card save in one transaction.
Existing linked iPhone accounts retain their original owner and data. Cancelled
or blocked accounts and revoked native profiles cannot restart onboarding to
replace their existing profile. An exact former native-signup origin is checked
only to preserve recovery protections; it is never an email-based lookup.

Device verification: use a fresh, verified development identity, confirm the
athlete form opens without a PWA visit, save with optional fields blank, relaunch,
and verify the same athlete and one private starter card remain. Also use an
email already registered in the PWA: it should open a blank iPhone profile
without offering account connection or changing any PWA data.
Development API checks do not replace an Xcode build or physical-iPhone check.

Interrupted setup recovery: the profile endpoint reports `requiresSetup` when
the owner card is missing, even if a legacy linked owner's managed Clerk profile
already saved the athlete details. New independent native profiles save their
details and starter cards atomically, so both roll back on a write failure.
Relaunch reopens Athlete setup with those details filled in and a recovery
message; Continue creates one private paused card. Profile reads never create
cards, and existing authored cards remain unchanged. The standalone native
policy checks run on a Mac:

```sh
swiftc -parse-as-library "ios/PIXL Sports/NativeSupporterProfile.swift" \
  ios/Tests/NativeStarterSetupRecoveryChecks.swift -o /tmp/pixl-starter-recovery-checks
/tmp/pixl-starter-recovery-checks
```

For legacy linked-owner device verification, interrupt a setup save after the managed profile write
but before its response reaches the API, relaunch, and confirm the saved details
and Continue action are visible. Continue, relaunch again, and confirm setup no
longer opens and exactly one private paused card exists. Repeat with an authored
card and confirm its identity, media, visibility, and publication are unchanged.
For a new independent iPhone profile, interrupt a failed setup write, relaunch,
and confirm setup is still offered; Continue must save both the profile and one
private paused card.

### HYPE Card photo checks

See [native photo verification](Tests/native-athlete-photo-device-checks.md) for
the Apple-native preparation command, physical-iPhone iCloud/cancellation,
failure/retry, relaunch, and removal checklist, and explicit environment limits.

References:
- https://clerk.com/docs/ios/getting-started/quickstart?manual=1
- https://clerk.com/docs/ios/reference/views/authentication/auth-view
- https://clerk.com/docs/guides/configure/auth-strategies/sign-in-with-apple?sdk=ios
