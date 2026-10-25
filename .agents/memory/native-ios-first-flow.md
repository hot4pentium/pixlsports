---
name: Cross-platform account path
description: The selected client and shared-auth direction for PIXL Sports.
---

Target a native SwiftUI iPhone app for the App Store; keep the existing PWA and its Replit-managed Clerk sign-in for web and Android (the PWA can be packaged for Google Play as a Trusted Web Activity). The user approved a dedicated external Clerk app for iOS-only authentication, with Sign in with Apple and the prebuilt native UI. It must securely link to existing PIXL account/data. Replit-managed Clerk supports the web app but not native ClerkKit/Native API, and its accounts are not designed for direct export. Existing records are keyed to Clerk user IDs, so the API needs a verified identity-linking strategy.

Do not replace PWA auth, migrate production accounts, or connect the SwiftUI project to the generic personal “My Application” Clerk project. The user chose a new dedicated iOS Clerk app instead. The native SwiftUI prototype remains part of the product; the PWA is not replacing it.

**Why:** the user chose to preserve the PWA sign-in and build a standalone native iOS app, with the native identity securely linked to existing account data.

**How to apply:** keep the PWA auth path intact; design native sign-in, Apple review compliance, and a one-time verified account-link flow before changing backend authorization or account data.
