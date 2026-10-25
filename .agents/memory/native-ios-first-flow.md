---
name: iPhone account path
description: The current decision for preserving PIXL Sports accounts on iPhone.
---

Use the existing PIXL Sports PWA on iPhone to preserve the Replit-managed Clerk accounts and current sign-in/onboarding. Do not link the SwiftUI prototype to a separate Clerk app such as a generic personal app. Replit-managed Clerk supports the web app, not native ClerkKit, Native API, or native Sign in with Apple.

The native SwiftUI prototype was initially aimed at Supporter Home and the next event, but native authentication is paused until the user explicitly chooses an auth migration. The current PWA is not being replaced or recreated.

**Why:** the user chose to keep existing accounts and use the PWA on iPhone rather than create a separate native sign-in system.

**How to apply:** improve or guide use of the existing iPhone PWA for now. Revisit native SwiftUI sign-in only after choosing a mobile-capable auth provider and an account-migration path.
