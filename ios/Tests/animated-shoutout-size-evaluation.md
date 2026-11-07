# Animated Shoutout Size Evaluation

## Supplied intro videos

The seven supplied videos are H.264 MP4s, each about three seconds long. The
original files also contain AAC audio. The selected product behavior uses the
separate Stadium Ignition cue instead, so all bundled intro encodes are silent.
The user's original uploads are not bundled.

Each intro is trimmed to the fixed 2.5-second app duration and encoded at 30 fps.
Landscape versions remain 16:9; Domination remains square. Every choice also
has a 720 × 1280 portrait variant that blurs and enlarges the background while
keeping the complete original animation centered in front.

| Intro | Source size | Landscape bundle | Portrait bundle |
| --- | ---: | ---: | ---: |
| Clutch | 5,834,186 B | 196,572 B | 191,971 B |
| Domination | 913,089 B | 130,364 B | 127,192 B |
| Game Changer | 4,827,515 B | 287,989 B | 281,174 B |
| Highlight | 3,289,769 B | 158,908 B | 165,400 B |
| Hustle | 5,097,284 B | 162,580 B | 160,879 B |
| Locked In | 5,218,433 B | 212,632 B | 208,928 B |
| Unstoppable | 2,941,414 B | 244,707 B | 234,520 B |
| **Total video assets** | **28,122,690 B** | **1,393,752 B** | **1,370,064 B** |

The fourteen silent video files total **2,763,816 bytes (2.76 MB)**, down from
about 28.1 MB for the seven originals. The optional Stadium Ignition cue adds
58,994 bytes. The seven matching still images remain as chooser thumbnails;
still-only Milestone, Next Level, and Victory are no longer choices.

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
