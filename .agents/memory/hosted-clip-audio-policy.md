---
name: Hosted clip audio policy
description: Why publishing and local exporting have different behavior when browser audio capture fails.
---

Hosted video posting must stop if the browser cannot capture a clip's audio track, rather than silently publishing a video-only copy. Local video downloads may still complete without sound, provided the owner is warned.

**Why:** A silently published highlight could mislead supporters about the intended media. A local export stays under the owner's control, so warning them is preferable to losing the usable video.

**How to apply:** When changing media preparation, preserve the audio-required boundary for hosted posting and keep selected local sources intact after preparation failures. Safari may suspend Web Audio contexts resumed only after asynchronous seeking, poster creation, or recording; begin audio activation during the user's Publish gesture and reuse the running context through recorded-blob verification. Treat capture limitations separately from general video decoding or recording errors. Automated sample checks do not replace the release check on a real supported iPhone Safari capture.