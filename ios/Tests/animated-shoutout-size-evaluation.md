# Animated Shoutout Size Evaluation

## Sample

The supplied clip is a silent 16:9 MP4:

Source: `attached_assets/0_clutch_16x9_slower_shake_1793927320127.mp4`

| Property | Value |
| --- | --- |
| Duration | 2.5 seconds |
| Frame size / rate | 1920 × 1080 at 30 fps |
| Video | H.264 High, 8-bit YUV 4:2:0 |
| Audio | None |
| File size | 1,482,040 bytes (1.48 MB) |
| Average bitrate | About 4.74 Mbps |

The current ten 1024 × 1024 shoutout JPEGs total 1,964,080 bytes (1.96 MB).
Ten clips at the supplied sample's size would total about 14.82 MB, roughly
7.5 times the still-image set. Replacing the stills at that quality would add
about 12.86 MB; keeping the stills for the chooser would add the full 14.82 MB.

## Local compression tests

The same sample was encoded as silent H.264 MP4 at 30 fps:

| Export | Size per clip | Ten clips | SSIM vs. source scaled to export size |
| --- | ---: | ---: | ---: |
| 1280 × 720, target 1 Mbps | 332,447 bytes | 3.32 MB | 0.9719 |
| 960 × 540, target 700 Kbps | 235,024 bytes | 2.35 MB | 0.9639 |

The shoutout wording remained readable in extracted frames from both exports.
The 720p version is the better quality/size balance. If the original stills
remain as selection thumbnails, ten 720p clips plus the stills would total about
5.29 MB before sound effects. The earlier 247,511-byte instrumental asset has
since been removed from the app.

## Clutch pilot added to Record Moments

The 1280 × 720, 30 fps export (332,447 bytes) is now included as an optional
local **Clutch · Animated** intro. The existing still-art choices remain
available. The animated intro uses its fixed 2.5-second duration, keeps the
selected footage allowance at up to 15 seconds, and is fit to the output frame
without cropping. In portrait output, the complete landscape video is centered
with black space above and below. The video is silent. A brief whoosh and soft
hit can play during the intro only; the effect ends before source-video audio
begins. No instrumental music is bundled or mixed under the action.

The bundled artwork, this animated pilot, and its 26,628-byte sound effect total
about 2.32 MB. The original 1080p upload is not bundled.

## Recommendation

- If all ten shoutouts are animated, target silent 1280 × 720 H.264 at 30 fps,
  about 1 Mbps, and roughly 2.5 seconds. Aim for no more than 350 KB per clip.
- A 960 × 540, 700 Kbps version is a smaller fallback, about 235 KB each.
- The optional sound effect is limited to the animated intro and can be turned
  off. There is no instrumental music bed.
- The sample is landscape 16:9. Portrait exports need a portrait-specific
  version or a tested layout that keeps the title readable; cropping this
  animation to fill a phone screen can cut off its text.

## iPhone/export verification boundary

This workspace has no Apple developer directory, Swift compiler, simulator, or
physical iPhone, so AVFoundation playback/export of the new video-intro path was
not verified. The feature is wired into the local Record Moments source for
simulator testing, but should be built and checked in Xcode before relying on
device playback, portrait framing, Photos save, or sharing.
