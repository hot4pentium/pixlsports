---
name: Hosted clip duration validation
description: Browser-recorded share clips may differ substantially from the chosen trim duration.
---

Treat the browser-produced MP4's measured duration and size as authoritative before publishing, not the selected trim duration or the requested MediaRecorder bitrate.

**Why:** One published Hype Page manifest claimed an 8.36-second selected segment while its complete MP4 was 17.3 seconds and nearly 35 MB. The requested low bitrate did not bound its actual size. The original source file was not independently measured in that investigation, so the stage that introduced the excess duration is unproven; do not describe the difference as extra recording without further evidence.

**How to apply:** Validate every prepared output's duration against its input before using it, validate the complete hosted output before upload, and record measured duration in share metadata. Existing clips are not fixed merely by changing future preparation.