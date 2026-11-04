---
name: WebKit media environment boundaries
description: Distinguish Linux media runtime failures from Safari or clip failures.
---

WebKitGTK media errors must be interpreted alongside the native GStreamer logs,
not just the browser's `MEDIA_ERR_SRC_NOT_SUPPORTED` status.

**Why:** Missing media plugins crashed the Linux web process, while a read-only
media-buffer directory later produced an unsupported-source error for a clip
that decoded correctly. Neither was evidence of a bad clip or an iPhone defect.

**How to apply:** Verify codecs and writable native media buffering before
attributing Linux WebKit playback failures to application code. Keep any
workaround isolated to the test process; do not alter production encoding or
streaming behavior to accommodate the test host. Still distinguish engine
coverage from Apple Safari and physical-device sign-off.
