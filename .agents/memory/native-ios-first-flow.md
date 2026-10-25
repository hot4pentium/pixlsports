---
name: Cross-platform account path
description: The selected client and shared-auth direction for PIXL Sports.
---

Target a native SwiftUI iPhone app for the App Store; keep the existing PWA and its Replit-managed Clerk sign-in for web and Android (the PWA can be packaged for Google Play as a Trusted Web Activity). The user approved a dedicated external Clerk app for iOS-only authentication, with Sign in with Apple and the prebuilt native UI. It must securely link to existing PIXL account/data. Replit-managed Clerk supports the web app but not native ClerkKit/Native API, and its accounts are not designed for direct export. Existing records are keyed to Clerk user IDs, so the API needs a verified identity-linking strategy.

Do not replace PWA auth, migrate production accounts, or connect the SwiftUI project to the generic personal “My Application” Clerk project. The user chose a new dedicated iOS Clerk app instead. The native SwiftUI prototype remains part of the product; the PWA is not replacing it.

Linking must prove the native identity and existing web owner independently, with explicit approval on both sides. Never infer ownership from matching emails or silently replace a connection. Disconnect preserves both accounts and their saved data.

Native development must not silently fall back to the published server when development configuration is missing. Safe troubleshooting should show the installed app's destination and HTTP status, never keys, tokens, or raw response bodies.

**Why:** new native endpoints can be present in the workspace but absent from the published website. A production fallback hides that distinction and makes repeated plist edits/rebuilds inconclusive.

**Why:** the user chose to preserve the PWA sign-in and build a standalone native iOS app, with the native identity securely linked to existing account data. The user confirmed the dedicated native Clerk/prebuilt UI approach works with Google sign-in and approved secure account linking next; keep this approach rather than replacing the PWA's auth.

**How to apply:** keep the PWA auth path intact; design native sign-in, Apple review compliance, and a one-time verified account-link flow before changing backend authorization or account data.
