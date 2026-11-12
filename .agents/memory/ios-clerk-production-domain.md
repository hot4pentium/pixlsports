---
name: iOS Clerk production domain isolation
description: Keep the external iOS Clerk instance's domain separate from the Replit-managed PWA tenant.
---

Use Clerk's **Secondary application** domain configuration for the dedicated iOS production instance under `ios-auth.pixlsports.com`. In this dialog, “secondary” scopes Clerk infrastructure to the subdomain; it is not a request to merge the PWA and iOS accounts.

**Why:** The PWA's Replit-managed Clerk setup already claims `pixlsports.com`. Selecting **Primary application** still uses the root domain for Clerk infrastructure even when the application address is a subdomain, and it triggered the same root-domain conflict. Selecting Secondary reached the production setup checklist.

**How to apply:** Follow the iOS instance's own DNS records and production configuration. Do not delete the Replit app, detach the PWA domain, or replace the PWA's Clerk keys to solve this conflict. Confirm the issuer from Clerk rather than constructing it from the application address. Keep secret keys out of the app, repository, and chat.

Clerk's official explanation: https://clerk.com/docs/guides/development/deployment/changing-domains
