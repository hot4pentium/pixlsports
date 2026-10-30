# PIXL Sports native iPhone sign-in

This SwiftUI app uses the separate **PIXL Sports iOS** external Clerk app.
The web/Android PWA keeps its existing Replit-managed Clerk configuration.
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
- Active game Event Cards can open the native Live Taps screen. Sending a cheer
  still requires scanning the owner’s private family QR; the public card link
  remains view-only. The iPhone uses the existing family-token tap endpoint,
  and Live Taps do not create stat-tracker plays or a separate history.

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
current native data surfaces. Stats, editing, and other account data are not
included. Every future private native read must resolve the verified mapping and
recheck current account lifecycle/editor restrictions; cached links or previously
loaded data are not access.

## Mac verification

This repository is edited on Linux, without Xcode or an iOS simulator. Build,
signing, and rendered native UI must be verified on the Mac.

The Event Card detail UI test launches a local fixture without signing in or
requesting private data. It limits the screen content to 320 points wide, sets
the largest accessibility text size, and checks that the date, opponent,
location, status, and Live Taps control remain reachable:

```sh
xcodebuild test -project "ios/PIXL Sports.xcodeproj" \
  -scheme "PIXL Sports" -destination 'platform=iOS Simulator,id=<iPhone simulator UUID>'
```

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

References:
- https://clerk.com/docs/ios/getting-started/quickstart?manual=1
- https://clerk.com/docs/ios/reference/views/authentication/auth-view
- https://clerk.com/docs/guides/configure/auth-strategies/sign-in-with-apple?sdk=ios
