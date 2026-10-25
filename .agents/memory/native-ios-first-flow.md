---
name: Cross-platform account path
description: The selected client and shared-auth direction for PIXL Sports.
---

Target a native SwiftUI iPhone app for the App Store, keep the existing PWA for web and Android (packaged for Google Play as a Trusted Web Activity), and use one shared login across all three. Replit-managed Clerk supports the web app but not native ClerkKit/Native API; its accounts are not designed for direct export to another Clerk app. Existing records are keyed to Clerk user IDs, so a provider change requires an explicit identity/data transition plan.

Do not link the native project to the personal generic “My Application” Clerk project without explicit confirmation that it is the chosen new shared provider. The SwiftUI prototype remains part of the product; the PWA is not replacing it.

**Why:** the user chose native App Store delivery, keeping the PWA for Android/web, and one shared login, while accepting that an account transition must be planned.

**How to apply:** plan a mobile-capable provider for both the PWA and native iOS client; establish how existing users reconnect their saved data before changing auth configuration or production accounts.
