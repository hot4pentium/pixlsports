---
name: Hosted clip duration validation
description: Browser-recorded share clips may differ substantially from the chosen trim duration.
---

Treat the browser-produced MP4's measured duration and size as authoritative before publishing, not the selected trim duration or the requested MediaRecorder bitrate.

**Why:** One published Hype Page manifest claimed an 8.36-second selected segment while its complete MP4 was 17.3 seconds and nearly 35 MB. The requested low bitrate did not bound its actual size. Browser recording takes wall-clock time and can run long if source playback or encoding stalls.

**How to apply:** Validate complete output media before upload, reject or retry badly timed or oversized results, and record the measured duration in the share metadata. Existing clips are not fixed merely by changing future preparation.