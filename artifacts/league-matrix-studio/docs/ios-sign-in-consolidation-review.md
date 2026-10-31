# PIXL iOS and Web Sign-In Review

**Reviewed:** 2026-10-31

## User goal

Families explicitly sign in or create an account after installing the iPhone app. Existing PIXL users should use their existing account; new users should create one PIXL account that works on iPhone and web. Installing the app from the App Store is not authentication.

## Current setup

- The web app and PWA use the Replit-managed Clerk tenant.
- The SwiftUI app uses a dedicated external Clerk application configured from `ClerkConfig.plist`.
- The API verifies native Clerk tokens against a server-configured native issuer. A native user ID and a web user ID are not interchangeable.
- Existing PIXL records are owned by the web Clerk user ID. The native account-link flow requires the iPhone user to initiate a request, the existing web user to approve it while signed in, and the iPhone user to confirm. The server stores a verified mapping; it never joins accounts by matching email.
- Disconnecting removes the mapping, not either account or its data.

## App Store and Apple sign-in

An App Store download does not give PIXL an authenticated Apple ID session or a trusted PIXL user identity. Apple’s Sign in with Apple documentation describes a separate authorization flow initiated by the user. It can be a sign-in method for PIXL, but it is not automatic authentication from installing the app. A saved Clerk session may restore a prior login on later launches; that is separate from App Store access.

## Authentication options

| Option | User experience | Data and migration impact |
| --- | --- | --- |
| Keep the current separate Clerk apps | Existing users sign in to the iPhone Clerk app, then connect their web PIXL account. | Lowest immediate risk, but keeps the extra iPhone-only identity and does not meet the desired long-term experience. |
| Use one external Clerk app for web and iPhone | One PIXL sign-in works on both clients; the user still explicitly signs in after installation. | Recommended target. Replit’s Clerk documentation says its managed tenant cannot be reused by an external native iOS app. Both clients would need to use an external Clerk app. Replit-managed users cannot be exported into that tenant with their existing Clerk IDs, so existing account ownership needs a verified transition. |
| Treat App Store installation as sign-in | No login screen after download. | Not a supported authentication path; the store does not provide the app with the user’s Apple ID identity. |

## Recommendation

Use the existing dedicated external iOS Clerk app as the candidate shared PIXL sign-in for both SwiftUI and the web app. Keep explicit sign-in or sign-up after installation. Configure the desired providers on that one Clerk app; Sign in with Apple can be one option, but must remain a user-approved login.

Do not switch the web app or production API until a migration prototype proves existing users retain access to their current records. Replit-managed Clerk accounts and IDs do not transfer to the external tenant. Preserve existing data ownership through a server-verified identity mapping or a separately reviewed stable PIXL account identifier. Do not infer identity from email, and do not rewrite or delete existing account data as part of the initial sign-in change.

For existing users, a one-time verified connection to their old web account may be needed during migration. Users who already completed the current approved link can use that proof as a starting point, but the migration must verify the mapping and handle conflicts. Once migrated, the same external Clerk account should sign the user into both iPhone and web. New users should create that shared account once.

## Staged migration and safety gates

1. **Prove the shared development setup.** Configure a test web client and the iPhone build against the same external Clerk development application. Confirm sign-in, sign-out, session restoration, provider configuration, and server token verification on both clients.
2. **Design legacy ownership resolution.** Determine how an authenticated shared-Clerk identity maps to the existing web Clerk owner for every private-data endpoint. Require proof of both identities for existing accounts; never match by email. Keep account lifecycle restrictions and admin blocks enforced.
3. **Migrate a controlled test cohort.** Verify existing linked and unlinked accounts, account conflicts, password/account recovery, and access to private schedules and saved records. Keep the old web sign-in available to users who have not migrated.
4. **Cut over gradually only after approval.** Maintain the old owner IDs and a reversible identity map during rollout. Keep the old sign-in path available until migration coverage and recovery procedures are proven; do not delete old tenant access or rewrite data during the first cutover.
5. **Decide on final cleanup separately.** Only after all users have a verified shared identity should PIXL decide whether to retain the mapping indefinitely or later migrate records to an internal stable account ID.

## Decisions still needed before implementation

- Confirm the existing dedicated iOS Clerk app is the intended shared tenant, and choose the sign-in providers users should see on both clients.
- Decide the migration experience for existing web users who have never connected an iPhone identity.
- Approve whether a stable internal PIXL account ID is a later goal or whether a verified identity map is sufficient.
- Do not disable PWA/web sign-in as part of this authentication review.

## Sources and code checked

- Replit Clerk Auth documentation, including managed-tenant reuse and user-export limitations, checked 2026-10-31.
- [Apple: Implementing User Authentication with Sign in with Apple](https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple)
- `.agents/memory/native-ios-first-flow.md`
- `ios/PIXL Sports/NativeAuthRootView.swift`
- `ios/PIXL Sports/NativeAccountLinkView.swift`
- `ios/PIXL Sports/NativeClerkConfiguration.swift`
- `artifacts/api-server/src/lib/nativeIdentity.ts`
- `artifacts/api-server/src/lib/nativeAccountLink.ts`
- `artifacts/api-server/src/routes/nativeAccountLink.ts`
- `artifacts/league-matrix-studio/src/app-entry.tsx`
