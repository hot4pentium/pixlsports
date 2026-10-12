---
name: Background-tab polling tests
description: Reliable browser verification of periodic query refreshes from open tabs.
---

When a browser test expects a page's polling query to react to a server-side change, activate that page's target before waiting for the refresh.

**Why:** Headless Chromium can throttle timers in inactive tabs, so a valid polling interval may not fire within the test's expected window.

**How to apply:** Keep public pages open as needed for multi-session checks, but use CDP target activation before verifying a timer-driven update on each page.
