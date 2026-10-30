---
name: Cross-platform account path
description: The selected client and shared-auth direction for PIXL Sports.
---

Target a native SwiftUI iPhone app for the App Store; keep the existing PWA and its Replit-managed Clerk sign-in for web and Android (the PWA can be packaged for Google Play as a Trusted Web Activity). The user approved a dedicated external Clerk app for iOS-only authentication, with Sign in with Apple and the prebuilt native UI. It must securely link to existing PIXL account/data. Replit-managed Clerk supports the web app but not native ClerkKit/Native API, and its accounts are not designed for direct export. Existing records are keyed to Clerk user IDs, so the API needs a verified identity-linking strategy.

Do not replace PWA auth, migrate production accounts, or connect the SwiftUI project to the generic personal “My Application” Clerk project. The user chose a new dedicated iOS Clerk app instead. The native SwiftUI prototype remains part of the product; the PWA is not replacing it.

The iOS `ClerkConfig.plist` publishable key must belong to the dedicated iOS Clerk instance, not the Replit-managed web app. **Why:** the API verifies the native token against the separately configured iOS issuer, so a web-instance token can return HTTP 401. **How to apply:** when restoring the plist, pair the iOS app key with the server's native issuer configuration; never ask the user to paste a key into chat.

Linking must prove the native identity and existing web owner independently, with explicit approval on both sides. Never infer ownership from matching emails or silently replace a connection. Disconnect preserves both accounts and their saved data.

Native development must not silently fall back to the published server when development configuration is missing. Safe troubleshooting should show the installed app's destination and HTTP status, never keys, tokens, or raw response bodies.

Replit's private development preview can redirect requests from an external native client before they reach the API. Check the preview's privacy setting before changing a valid API origin or weakening the native client's no-redirect policy. Do not bundle a Replit external-access token in the app; use temporary public preview access only for a deliberate test, then restore privacy.

**Why:** new native endpoints can be present in the workspace but absent from the published website. A production fallback hides that distinction and makes repeated plist edits/rebuilds inconclusive.

**Why:** the user chose to preserve PWA sign-in and build a standalone native iOS app, then selected the private Event Card schedule as its first data milestone. It must not depend on a public HYPE Card or match users by email.

**Why:** the user approved translating the existing PIXL web visual style into SwiftUI screen by screen, starting with the schedule, while keeping native sign-in and real private schedule data.

**Why:** `.replit.dev` previews are private by default; external iOS requests can receive an authentication redirect even when the API responds normally inside the workspace.

**How to apply:** keep PWA auth intact. Every native private read must resolve the verified native-to-web account link, recheck current account restrictions, return only the data needed by that screen, and avoid caching private schedule data. Translate the shared brand into native SwiftUI one screen at a time rather than embedding the PWA.
