---
name: Chromium browser diagnostics
description: Durable guidance for actionable CDP browser-test failures.
---

Keep Chromium-based browser checks on a shared diagnostic path that captures bounded stdout/stderr, exit status, DevTools socket failures, and page/target lifecycle events.

**Why:** A raw child-process wait or quiet CDP wrapper turns browser crashes and target detaches into opaque navigation or timeout failures.

**How to apply:** Pass the Chromium process monitor into the DevTools connection and include its diagnostics in startup, navigation, evaluation, and wait failures while preserving each suite's existing target cleanup.