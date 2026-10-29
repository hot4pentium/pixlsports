---
name: Public landing first paint
description: Product requirement for public root-route startup and the initial HTML shell.
---

First-time and signed-out visitors should see landing content immediately while Clerk initializes. On a device that previously reached an active signed-in dashboard, show the account-loading screen until Clerk restores the session; redirect to the Studio only after a loaded signed-in session is confirmed. Keep private Studio routes gated. The initial HTML shell should look like the landing page rather than a generic dark startup screen.

**Why:** The user said a black “Loading Pixl Sports” screen followed by a Studio access splash made the landing page feel bad to load.

**How to apply:** Preserve the immediate public landing on `/` for first-time and signed-out visits; use a non-sensitive, device-local marker only to choose a waiting screen on a returning session. Check that marker in the initial HTML before rendering the static shell, and mirror the choice in React startup. Never treat the marker as auth or account authority. Match the HTML boot shell to the current landing brand, and bump the offline-shell cache when changing the cached HTML.

The private account-loading splash uses the actual full PIXL SPORTS logo. Keep both parts of the logo legible while the screen remains concise and distinct from the public landing page.

**Why:** The user asked for a cooler splash screen with their logo.

**How to apply:** Preserve the public root's direct landing experience and the private account-loading flow's online, offline, error, and retry states when refreshing the splash presentation.

The previously-signed-in marker is a presentation hint only. Server lifecycle checks remain authoritative and private account data must never be restored based on this flag.

**Why:** The user requested a smooth return from app backgrounding without exposing the public landing during dashboard restoration.

**How to apply:** Set the marker only after the private dashboard is verified active. If session storage cannot be read, retain the existing safe public-entry behavior; never use this marker to grant or restore access.

For a returning signed-in session, keep the private-entry splash visible for at least five seconds from its initial HTML paint, even if Clerk restores the session faster. First-time and confirmed signed-out visits should still reach the public landing without an added delay.

**Why:** The user said the return splash appeared only briefly and asked for it to remain visible for five seconds.

**How to apply:** Start timing in the static HTML shell and let the React startup gate wait for both the minimum duration and Clerk's signed-in confirmation. Increase the offline-shell cache version when changing the HTML startup timestamp.

For a returning private session, keep one full-screen splash mounted as an overlay while the app tree initializes behind it. Keep the covered tree visually hidden, inert, and excluded from assistive technology until Clerk is loaded; signed-in sessions retain the five-second minimum, while confirmed signed-out visitors proceed without an added delay. Routine route and lifecycle loading beneath the overlay should use compact progress states, not another full-screen splash. Account access still depends on server-verified lifecycle state.

**Why:** The installed app showed the same splash three times because the startup gate, lazy-module fallback, and account-lifecycle gate each rendered it in sequence.

**How to apply:** Preserve the single overlay and the hidden/inert boundary when changing startup, auth, or route-loading behavior. Verify delayed session restoration and ensure private content stays inaccessible while covered.

Keep the full account splash for genuine startup/session verification only. Lazy screen-to-screen navigation should use a compact progress state instead of briefly replaying the full-screen splash.

**Why:** The user said seeing the splash flash between screens is jarring.

**How to apply:** Keep private access and lifecycle checks intact; change route-loading fallbacks rather than removing their loading state.
