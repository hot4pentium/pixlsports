---
name: Public landing first paint
description: Product requirement for public root-route startup and the initial HTML shell.
---

The public root route should show landing content immediately while Clerk initializes. Only redirect to the Studio after a loaded signed-in session is confirmed; keep private Studio routes gated. The initial HTML shell should look like the landing page rather than a generic dark startup screen.

**Why:** The user said a black “Loading Pixl Sports” screen followed by a Studio access splash made the landing page feel bad to load.

**How to apply:** Preserve the immediate public landing on `/`, match the HTML boot shell to the current landing brand, and bump the offline-shell cache when changing the cached HTML.
