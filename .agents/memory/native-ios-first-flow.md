---
name: Native iOS first flow
description: The selected first experience for the PIXL Sports native SwiftUI companion.
---

The native iOS companion should use the existing PIXL account, then show onboarding for first-time supporters before opening Supporter Home and the next event. Returning supporters should sign in and go directly to Home. Do not treat the public athlete-page link screen as the permanent app entry flow.

The user chose Clerk's native sign-in/sign-up UI and Sign in with Apple, and approved enabling Clerk's Native API for the iPhone app. The Clerk setup still requires running the official setup flow on the user's Mac with Xcode.

**Why:** the user chose Supporter Home and next event as the first native app flow, and clarified that the iPhone app should have account sign-in and first-time onboarding rather than a website-style landing page.

**How to apply:** reuse the existing account and supporter setup; keep the PWA separate, and send returning users to the event-focused home screen after authentication.
