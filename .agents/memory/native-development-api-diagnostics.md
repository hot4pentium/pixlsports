---
name: Native development API diagnostics
description: Distinguish Xcode-installed app connection failures from published-server failures.
---

Confirm the installed iPhone build's API destination and check the matching server before interpreting production telemetry.

**Why:** An Xcode-installed build returned HTTP 502 for connection checks and Event Card sync while production appeared healthy. Restarting the stopped development API restored connectivity, and the user confirmed that the existing Event Card synced without rebuilding.

**How to apply:** For native 502 reports, check the development API workflow as well as the configured destination. Missing production requests alone do not establish a production gateway failure. Retry the existing pending card rather than recreating it. Successful sync does not prove the pending draft was visible or usable offline; investigate that separately.

Event Card creation and editing should finish in the UI once protected on-device storage succeeds; server confirmation must not hold the form open or hide the user's event.

**Why:** The user explicitly said users need to see their events even when the server is unavailable, and raised customer reputation concerns about development-server interruptions.

**How to apply:** Keep pending events visible and editable under the verified account while background sync retries. Only claim cloud confirmation after acknowledgement. Customer distribution must use a published API with matching native authentication, not depend on the development workspace staying open.
