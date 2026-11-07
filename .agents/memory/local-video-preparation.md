---
name: Local video preparation
description: Product decision for source-video limits, local compression, trimming, and privacy.
---

Accept source videos up to 120MB, prepare a smaller MP4 locally when the browser supports it, and let users select a segment of no more than 15 seconds for preview and export.

**Why:** Larger phone videos should be accepted without sending youth-sports media to the server, while smaller working files reduce mobile storage and export failures.

**How to apply:** Keep original and converted video bytes on-device only. Save trim settings as part of the design. If local MP4 conversion is unavailable, retain the original local clip and explain the fallback.

Require a fresh shoutout choice for each newly imported source clip; do not silently carry the prior clip's choice forward.

**Why:** The user reported that a previous intro was unexpectedly included when making another clip.

**How to apply:** Clear the selected intro only after a new source imports successfully, and keep export unavailable until an intro is selected. Preserve the choice while editing the same clip.

Fresh selections must also replace the rendered preview, even when the user only previewed the previous clip and never saved it.

**Why:** The user reported a previous shoutout appearing only in the preview while the chooser showed the correct new selection.

**How to apply:** Invalidate finished previews when footage, intro, or audio changes, and give each replacement preview a fresh player-view identity.

Decorative video frames should surround the full, uncropped footage and match its proportions, rather than float inside the video. Keep the animated intro unframed.

**Why:** The user rejected the fixed-shape Graphite result and asked for a custom frame around the video.

**How to apply:** Keep the frame opening and footage placement consistent across preview and export, including non-16:9 source clips.

For the proposed shoutout-graphic export, put the chosen graphic before the full selected clip as a brief lead-in. Preserve up to 15 seconds of footage; the intro adds to the finished file duration instead of cutting into the footage. Keep the source video unchanged and let the user save the resulting MP4 to Photos for sharing. This is a local export idea, not permission to upload or publish the clip.

**Why:** The user chose an intro before the entire clip and explicitly chose to keep the full clip duration.

**How to apply:** Keep the short graphic card visually separate from the action, preserve clip audio, and make saving and sharing explicit.

The current Record Moments chooser should offer only the seven supplied animated shoutout videos with their matching poster images. Do not expose still-only shoutouts until a matching intro video is available. Use Stadium Ignition instead of the audio embedded in those supplied videos.

**Why:** The user asked to offer the supplied videos as intro choices, remove stills without matching videos, and chose Stadium Ignition in place of each video's embedded audio.

**How to apply:** Keep available choices one-to-one with the supplied animations. Do not mix the supplied MP4 audio with the common cue.

Record Moments exports must never generate a still-image shoutout intro or ending card. Poster artwork is only for the chooser; unavailable animations must produce an explicit error, not a still fallback.

**Why:** The user reiterated “We don't use stills anymore” after reporting Total Domination artwork after the animation and footage.

**How to apply:** Check both active and legacy export paths, and verify that finished playback ends on the user's footage rather than returning to an intro/poster.