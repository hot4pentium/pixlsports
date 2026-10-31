---
name: Cross-platform account path
description: The selected client and shared-auth direction for PIXL Sports.
---

Prioritize the native SwiftUI iPhone app as the mobile development target, using the existing PWA as the reference for product behavior and visual direction. Do not plan a separate native Android client now; this focus choice does not itself decide whether web or PWA access should be removed. The user approved a dedicated external Clerk app for iOS-only authentication, with Sign in with Apple and the prebuilt native UI. It must securely link to existing PIXL account/data. Replit-managed Clerk supports the web app but not native ClerkKit/Native API, and its accounts are not designed for direct export. Existing records are keyed to Clerk user IDs, so the API needs a verified identity-linking strategy.

Do not replace PWA auth, migrate production accounts, or connect the SwiftUI project to the generic personal “My Application” Clerk project. The user chose a new dedicated iOS Clerk app instead. The native SwiftUI prototype remains part of the product; the PWA is not replacing it.

The iOS `ClerkConfig.plist` publishable key must belong to the dedicated iOS Clerk instance, not the Replit-managed web app. **Why:** the API verifies the native token against the separately configured iOS issuer, so a web-instance token can return HTTP 401. **How to apply:** when restoring the plist, pair the iOS app key with the server's native issuer configuration; never ask the user to paste a key into chat.

Linking must prove the native identity and existing web owner independently, with explicit approval on both sides. Never infer ownership from matching emails or silently replace a connection. Disconnect preserves both accounts and their saved data.

Do not show a “PIXL account connected” card or connection-management section on the native dashboard.

**Why:** The user said the user does not need to manage their connection.

**How to apply:** Keep required first-time verification separate from the everyday dashboard. Removing this card does not change the verified identity-to-data mapping or authorize an authentication migration.

Use subtle translucent white backgrounds to distinguish the native dashboard's sections.

**Why:** The user said the sections otherwise blend together as one large section.

**How to apply:** Group the hero, upcoming events, and history into separate surfaces while preserving the navy backdrop and existing card layout.

The target family experience is explicit sign-up or sign-in after installation; App Store ownership is not authentication. Returning families should use their existing PIXL account, and new families should create one account usable on iPhone and web. A separate iPhone-only account and repeated web-account linking are transitional, not the desired long-term journey.

**Why:** the user explicitly confirmed this sign-in experience and wants to avoid making returning families create a second PIXL account.

**How to apply:** keep the current separate Clerk setup until a migration is reviewed and approved. Before any cutover, prove each existing user's identity-to-data mapping; never infer it from email. Preserve the existing web sign-in and records until users can securely access them through the shared identity.

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
