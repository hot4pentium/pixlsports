---
name: Checklist sharing test harness
description: Constraints for testing collaborative checklist routes and browser behavior in this workspace.
---

Direct Express route tests need a Clerk-branded `req.auth` function whose returned object includes `tokenType: "session_token"`; setting only `userId` is treated as signed out by Clerk's `getAuth`.

**Why:** The route middleware uses Clerk's real auth guard even when the route is mounted in a local test server, so an unbranded test function produces a misleading 401.

**How to apply:** Use generated API-Zod schemas to validate server test requests and responses, and use the installed Chromium DevTools protocol for browser-level checklist flows when no Playwright dependency is present.

A placeholder Clerk publishable key pointing to `example.com` can leave full-app browser routes stuck on “Checking account access…” while Clerk tries to load its script.

**Why:** The global Clerk provider gates app rendering until its client loads, so a syntactically accepted fake key can look like a route or API problem.

**How to apply:** For direct Vite browser checks, pass the configured development publishable key through the environment without printing it; only stub Clerk when authentication itself is outside the test.