---
name: Public landing first paint
description: Product requirement for public root-route startup and the initial HTML shell.
---

First-time and signed-out visitors should see landing content immediately while Clerk initializes. On a device that previously reached an active signed-in dashboard, show the account-loading screen until Clerk restores the session; redirect to the Studio only after a loaded signed-in session is confirmed. Keep private Studio routes gated. The initial HTML shell should look like the landing page rather than a generic dark startup screen.

**Why:** The user said a black “Loading Pixl Sports” screen followed by a Studio access splash made the landing page feel bad to load.

**How to apply:** Preserve the immediate public landing on `/` for first-time and signed-out visits; use a non-sensitive, device-local marker only to choose a waiting screen on a returning session. Never treat the marker as auth or account authority. Match the HTML boot shell to the current landing brand, and bump the offline-shell cache when changing the cached HTML.

The private account-loading splash uses the actual full PIXL SPORTS logo. Keep both parts of the logo legible while the screen remains concise and distinct from the public landing page.

**Why:** The user asked for a cooler splash screen with their logo.

**How to apply:** Preserve the public root's direct landing experience and the private account-loading flow's online, offline, error, and retry states when refreshing the splash presentation.

The previously-signed-in marker is a presentation hint only. Server lifecycle checks remain authoritative and private account data must never be restored based on this flag.

**Why:** The user requested a smooth return from app backgrounding without exposing the public landing during dashboard restoration.

**How to apply:** Set the marker only after the private dashboard is verified active. If session storage cannot be read, retain the existing safe public-entry behavior; never use this marker to grant or restore access.
