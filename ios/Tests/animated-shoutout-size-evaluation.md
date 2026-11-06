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
5.29 MB before intro music. The former 247,511-byte music bed is no longer
bundled; the current intro-only cue is 58,994 bytes.

## Clutch pilot added to Record Moments

The 1280 × 720, 30 fps export (332,447 bytes) is included as **Clutch ·
Animated**. The supplied **Domination · Animated** clip is also bundled as a
1280 × 720, 30 fps H.264 MP4 (200,418 bytes). The still-art choices remain
available for both. Animated intros use a fixed 2.5-second duration, keep the
selected footage allowance at up to 15 seconds, and fit the output frame
without cropping. Portrait footage now selects a dedicated 9:16 version
(described below); landscape footage keeps the original 16:9 version. The intro
clips are silent; the 58,994-byte AAC Stadium Ignition cue can play during either
intro and fades out before source-video audio begins. No music is mixed under
the action.

## Portrait-safe versions

Each animated pilot now has a 9:16 version for portrait source footage. The
portrait encode uses a blurred, enlarged fill behind the entire original
landscape animation, centered without cropping. This keeps all title text and
animation visible while using the full portrait preview and output frame.
Landscape footage continues to use the landscape version. The exporter picks
the matching version from the source video's oriented dimensions.

| Portrait version | Frame size / rate | Duration | File size |
| --- | --- | ---: | ---: |
| Clutch | 720 × 1280 at 30 fps | 2.5 seconds | 335,862 bytes |
| Domination | 720 × 1280 at 30 fps | 3.03 seconds | 287,210 bytes |

The two portrait versions add **623,072 bytes (0.62 MB / 0.59 MiB)** to the
bundle. Together, both landscape and portrait versions total 1,155,937 bytes;
including the 58,994-byte intro music cue and 1,964,080 bytes of shoutout
artwork, the animated shoutout set totals **3,179,011 bytes (3.18 MB)**. The
original Domination upload is not bundled.

The Apple export checks render both portrait variants into portrait MP4s and
compare the full output against the portrait source at multiple timestamps.
They also compare the center landscape band against the corresponding original
frames, checking that the title and animation remain intact rather than being
cropped. Local extracted-frame review confirmed the treatment preserves the
Clutch and Domination wording at phone-preview scale.

## Recommendation

- For landscape versions, target silent 1280 × 720 H.264 at 30 fps, about
  1 Mbps, and roughly 2.5 seconds. For portrait, use 720 × 1280 with the full
  landscape animation centered over a blurred fill. Aim for no more than 350 KB
  per version.
- A 960 × 540, 700 Kbps version is a smaller fallback, about 235 KB each.
- The optional music cue is limited to the animated intro and can be turned
  off. It never continues under the selected action.
- The supplied source remains landscape 16:9; portrait versions use a tested
  full-frame layout instead of cropping it to fill the phone screen.

## iPhone/export verification boundary

This workspace has no Apple SDK or physical iPhone, so AVFoundation playback,
export, and device preview were not run here. The Apple-platform test now checks
portrait source selection, finished MP4 framing, and uncropped title frames;
run it on macOS with Xcode, then inspect the finished preview and sharing flow
on an iPhone before release.
