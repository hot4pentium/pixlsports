---
name: Chromium browser diagnostics
description: Durable guidance for actionable CDP browser-test failures.
---

Keep Chromium-based browser checks on a shared diagnostic path that captures bounded stdout/stderr, exit status, DevTools socket failures, and page/target lifecycle events.

**Why:** A raw child-process wait or quiet CDP wrapper turns browser crashes and target detaches into opaque navigation or timeout failures.

**How to apply:** Pass the Chromium process monitor into the DevTools connection and include its diagnostics in startup, navigation, evaluation, and wait failures while preserving each suite's existing target cleanup.

For install-prompt journeys, headless Chromium does not provide a reliable native `beforeinstallprompt` event. Emulate the target UA, platform, and touch points through CDP, then dispatch a cancelable event with test-owned `prompt` and `userChoice` properties.

**Why:** This keeps Android prompt handling and iPhone/iPad fallback rendering testable without depending on a desktop browser's install eligibility or a physical-device Share menu.

**How to apply:** Keep the synthetic event limited to the browser test, and assert the real rendered public recipient card after the event or platform override.