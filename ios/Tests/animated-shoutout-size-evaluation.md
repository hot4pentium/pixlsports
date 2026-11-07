# Animated Shoutout Size Evaluation

## Supplied intro videos

The supplied videos are H.264 MP4s. The latest Domination and Unstoppable
uploads are 3.018 and 4.064 seconds long, respectively. The original files
contain AAC audio. The selected product behavior uses the separate Stadium
Ignition cue instead, so all bundled intro encodes are silent. The user's
original uploads are not bundled.

Each intro is trimmed to the fixed 2.5-second app duration and encoded at 30 fps.
All landscape versions are 16:9. Every choice also has a 720 × 1280 portrait
variant that blurs and enlarges the background while keeping the complete
original animation centered in front.

| Intro | Source size | Landscape bundle | Portrait bundle |
| --- | ---: | ---: | ---: |
| Clutch | 5,834,186 B | 196,572 B | 191,971 B |
| Domination | 5,153,582 B | 285,023 B | 215,672 B |
| Game Changer | 4,827,515 B | 287,989 B | 281,174 B |
| Highlight | 3,289,769 B | 158,908 B | 165,400 B |
| Hustle | 5,097,284 B | 162,580 B | 160,879 B |
| Locked In | 5,218,433 B | 212,632 B | 208,928 B |
| Unstoppable | 2,253,980 B | 325,366 B | 230,273 B |
| **Total video assets** | **31,675,749 B** | **1,629,070 B** | **1,454,297 B** |

The fourteen silent video files total **3,083,367 bytes (3.08 MB)**, down from
about 31.7 MB for the seven original uploads. The optional Stadium Ignition cue
adds 58,994 bytes. Domination and Unstoppable chooser thumbnails now use frames
from their replacement animations; still-only Milestone, Next Level, and
Victory are no longer choices.

## Export behavior

Each intro adds 2.5 seconds before the selected action footage, preserving the
full footage allowance of up to 15 seconds. The optional Stadium Ignition cue
fades out before the original video's audio begins; the supplied intro videos'
embedded audio is stripped to avoid layering tracks. No music plays over the
action.

The Apple export checks verify that all fourteen files have the expected
duration, orientation, and silent audio tracks; they compare the portrait
foreground with its matching landscape animation. Production exports are also
checked with music for Clutch and Domination.

## iPhone/export verification boundary

AVFoundation playback and export still need verification with Xcode on macOS.
Run `bash ios/Tests/verify-record-moments-apple.sh`, then inspect all seven
choices, portrait and landscape outputs, the music toggle, Photos save, and
sharing on a simulator or iPhone before release.
