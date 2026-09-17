---
name: Checklist sharing test harness
description: Constraints for testing collaborative checklist routes and browser behavior in this workspace.
---

Direct Express route tests need a Clerk-branded `req.auth` function whose returned object includes `tokenType: "session_token"`; setting only `userId` is treated as signed out by Clerk's `getAuth`.

**Why:** The route middleware uses Clerk's real auth guard even when the route is mounted in a local test server, so an unbranded test function produces a misleading 401.

**How to apply:** Use generated API-Zod schemas to validate server test requests and responses, and use the installed Chromium DevTools protocol for browser-level checklist flows when no Playwright dependency is present.