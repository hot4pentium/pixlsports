---
name: iOS-first account boundaries
description: Independent native profiles, preservation of legacy linked data, and native authentication setup.
---

Prioritize the native SwiftUI iPhone app as the mobile development target, using the existing PWA as a reference for product behavior. Do not plan a separate native Android client now; this focus choice does not itself decide whether web or PWA access should be removed. The user approved a dedicated external Clerk app for iOS-only authentication, with Sign in with Apple and the prebuilt native UI. Legacy iPhone accounts already using PWA data must retain their verified ownership bindings. New signups receive separate iOS profiles without connecting to the PWA.

Do not replace PWA auth, migrate production accounts, or connect the SwiftUI project to the generic personal “My Application” Clerk project. The user chose a new dedicated iOS Clerk app instead. The native SwiftUI prototype remains part of the product; the PWA is not replacing it.

The iOS `ClerkConfig.plist` publishable key must belong to the dedicated iOS Clerk instance, not the Replit-managed web app. **Why:** the API verifies the native token against the separately configured iOS issuer, so a web-instance token can return HTTP 401. **How to apply:** when restoring the plist, pair the iOS app key with the server's native issuer configuration; never ask the user to paste a key into chat.

Native server-side Clerk operations must use the same instance as the configured native JWT issuer, independently of the PWA's managed credentials.

**Why:** successful Google sign-in and authenticated API reachability do not prove that first-time profile setup can read the native identity. A connector marked production can still contain credentials whose public keys match the development instance.

**How to apply:** verify the provider/issuer public-key match in the actual runtime before signup or provider deletion. Workspace connector probes alone do not establish published-runtime credentials. Keep native development, native production, and PWA authentication isolated.

Legacy linking, when used for recovery, must prove the native identity and existing web owner independently, with explicit approval on both sides. Never infer ownership from matching emails or silently replace a connection. Disconnect preserves both accounts and their saved data.

Do not show a “PIXL account connected” card or connection-management section on the native dashboard.

**Why:** The user said the user does not need to manage their connection.

**How to apply:** Keep required first-time verification separate from the everyday dashboard. Removing this card does not change the verified identity-to-data mapping or authorize an authentication migration.

The native Prep screen's top content should show only the event date, without a routine connected-account box.

**Why:** The user requested a date-only Prep header and removal of the “connected to your PIXL account” box.

**How to apply:** Keep actionable save, retry, and error feedback; omit redundant event metadata and routine account-status panels from Prep.

The family experience is explicit sign-up or sign-in after installation; App Store ownership is not authentication. The user stated that profiles will only be iOS and that users do not need to connect a PIXL/PWA account. Native welcome and onboarding messaging should describe iPhone sign-in and athlete setup, not web-account connection.

New iPhone signups must be able to create their backing PIXL account and reach athlete setup without first visiting the PWA. The user explicitly approved building this flow; keep existing-account ownership verification and PWA authentication intact.

New iPhone signups receive independent iOS profiles, including when the same email already exists in the PWA. Email must never select, copy, link, or merge a PWA profile. Do not create a PWA authentication identity merely to hold a new iOS athlete's details.

**Why:** the user explicitly chose separate iOS profiles and said profiles will only be iOS, without a PIXL/PWA connection step.

The managed Clerk tenant requires an authentication identifier and rejected identifier-less shadow users. Do not fabricate email addresses or verified identifiers to create native backing users in that tenant.

**How to apply:** derive new profile ownership from the verified native issuer and subject, keep credentials server-side, and commit profile setup and access atomically. Preserve already-linked iOS owners and their saved data unchanged; do not migrate or detach them as part of new signup. Revocation and lifecycle restrictions must not be bypassed by creating a replacement profile.

**Why:** the user said, “No need to connect a pixl account as profiles will only be iOS.”

**How to apply:** keep user-facing iPhone profile setup independent of the PWA. Preserve existing web sign-in and records; do not silently detach, reassign, or delete existing account data while implementing this direction.

Native development must not silently fall back to the published server when development configuration is missing. Safe troubleshooting should show the installed app's destination and HTTP status, never keys, tokens, or raw response bodies.

Replit's private development preview can redirect requests from an external native client before they reach the API. Check the preview's privacy setting before changing a valid API origin or weakening the native client's no-redirect policy. Do not bundle a Replit external-access token in the app; use temporary public preview access only for a deliberate test, then restore privacy.

**Why:** new native endpoints can be present in the workspace but absent from the published website. A production fallback hides that distinction and makes repeated plist edits/rebuilds inconclusive.

**Why:** the user chose to focus mobile development on native iOS, use the PWA as its design and behavior reference, and avoid expanding to another native mobile platform. The first data milestone is the private Event Card schedule. It must not depend on a public HYPE Card or match users by email.

**Why:** `.replit.dev` previews are private by default; external iOS requests can receive an authentication redirect even when the API responds normally inside the workspace.

**How to apply:** every native private read must resolve the verified native-to-web account link, recheck current account restrictions, return only the data needed by that screen, and avoid caching private schedule data. Use the PWA for workflows, visual references, assets, and API contracts; implement native screens in SwiftUI rather than assuming React/CSS can be reused. Do not remove web or PWA access without an explicit migration decision.

## Source and Mac copy

Replit's SwiftUI project is the source of truth. GitHub transfers changes to the single Mac build/test clone at `~/Projects/pixlsports-xcode`.

**Why:** the user selected Replit's SwiftUI project as the main copy after confusion caused by multiple local projects and lost local sign-in configuration.

**How to apply:** make source edits in Replit, sync through GitHub, and pull into that Mac clone before building. Preserve locally configured `ClerkConfig.plist` values; do not replace them with repository placeholders or treat installed simulator bundles as source projects.
