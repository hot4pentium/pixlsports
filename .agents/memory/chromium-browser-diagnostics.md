---
name: Chromium browser diagnostics
description: Durable guidance for actionable CDP browser-test failures.
---

Keep Chromium-based browser checks on a shared diagnostic path that captures bounded stdout/stderr, exit status, DevTools socket failures, and page/target lifecycle events.

**Why:** A raw child-process wait or quiet CDP wrapper turns browser crashes and target detaches into opaque navigation or timeout failures.

**How to apply:** Pass the Chromium process monitor into the DevTools connection and include its diagnostics in startup, navigation, evaluation, and wait failures while preserving each suite's existing target cleanup.

When a browser check owns a temporary HTTP server and Chromium profile, bound cleanup of both the browser process tree and server connections even after an assertion fails.

**Why:** Killing only the Chromium parent can leave child processes writing to the profile, while open HTTP connections prevent a test runner from exiting and hide the original failure behind a timeout.

**How to apply:** Use a process-group termination with escalation if needed, close active server connections, and keep profile cleanup failures from skipping the server close.

Browser tests that call a fixture API on another origin must handle CORS preflights, including the custom test-auth header.

**Why:** A browser-generated `OPTIONS` request fails before the fixture route runs unless the test server allows the origin, requested headers, and method.

**How to apply:** Add the fixture's required CORS response headers and return a successful response for `OPTIONS` before route handling.

For install-prompt journeys, headless Chromium does not provide a reliable native `beforeinstallprompt` event. Emulate the target UA, platform, and touch points through CDP, then dispatch a cancelable event with test-owned `prompt` and `userChoice` properties.

**Why:** This keeps Android prompt handling and iPhone/iPad fallback rendering testable without depending on a desktop browser's install eligibility or a physical-device Share menu.

**How to apply:** Keep the synthetic event limited to the browser test, and assert the real rendered public recipient card after the event or platform override.

Very tall headless Chromium screenshots can show transformed PNG previews as blank rectangles even when the images have loaded and decoded.

**Why:** An oversized viewport capture showed white dashboard frames while the same page's images had nonzero natural dimensions and rendered correctly in ordinary desktop and phone viewport captures.

**How to apply:** Before treating blank areas in a tall capture as an app bug, check image loading and capture a normal-height viewport after scrolling the section into view through CDP.