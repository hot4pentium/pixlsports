---
name: Native launch privacy
description: PIXL iOS startup should hide account and schedule retrieval behind a branded screen.
---

Keep Clerk session restoration and the initial private schedule request behind one PIXL-branded splash. Show the native sign-in screen once the app confirms the user is signed out; show the dashboard after its first schedule result, including explicit error or unlinked states. Do not replay the full-screen splash for later refreshes.

**Why:** The user said people should not see behind-the-scenes messages such as account retrieval and asked for a splash that remains until the dashboard is ready.

The approved splash presentation is a large, centered PIXL logo on a solid white canvas, with a subtle scale pulse while the dashboard is loading. Do not show the textured grid on the splash. Respect Reduce Motion.

**Why:** The user asked to remove the field-like grid from the splash and use a plain white background.

**How to apply:** Keep the splash as a presentation boundary only. Preserve server authorization, clear retryable errors, and account-switch isolation; never use saved dashboard data to bypass verification. Keep any loading copy user-friendly and keep retry actions visible when startup fails.
