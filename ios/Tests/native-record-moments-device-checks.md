# Record Moments release checks

## Evidence boundary

This feature was implemented in a Linux workspace without Apple SDKs, an iOS
simulator, or a physical iPhone. Swift syntax parsing and Node source/asset checks
are not iOS type checking or Apple codec execution. **No successful native app
build, exported-MP4 execution, camera capture, Photos write, or native share
completion is claimed from this environment. The long-source thumbnail,
replacement, and dismissal checks below also require a physical iPhone; they
remain unverified until the device, iOS version, and results are recorded.**

## Automated Apple media checks

On a Mac with full Xcode and the project's dependencies:

```sh
bash ios/Tests/verify-record-moments-apple.sh
```

This runs the production AVFoundation exporter, not a replacement FFmpeg pipeline.
It creates synthetic landscape, rotated-portrait, audible, and short silent
sources. It checks the **actual MP4 duration** (17 seconds for a full selection),
samples the early and late intro and first/last selected action frames, checks
orientation/letterboxing, decodes source audio at the selected beginning and
tail, exercises cancellation and invalid media, and checks intro cleanup. Then it
builds the complete unsigned iOS app. Evidence and MP4s stay under the ignored
`generated-artifacts/native-record-moments/` directory.

The Graphite export fixtures also include 4:3, tall 3:4, and square sources. The 16:9
landscape frame stays centered and proportional on those exports: the source
video remains visible without cropping in the unframed area above and below the
frame. These are visible footage margins, not black bars. The checks compare
source pixels in those margins and in the transparent opening, confirm the
frame border is present, preserve the output aspect ratio, and verify the intro
has no frame.

The tall 3:4 fixture uses a 240×320 source and the supplied 9:16 portrait
Graphite frame. Its output must remain 3:4, with the transparent opening
revealing the footage and the intro unframed. The narrower frame leaves source
footage visible on both sides; asymmetric corner samples at the beginning and
end of the selected footage catch cropping, stretching, and black side bars.

The audio fixture changes tone at source second 17. A selection from second 3
through second 18 must retain the changed tone at the end. Reducing footage to
13 seconds to accommodate the intro must fail both frame and sound checks.

## Physical iPhone acceptance

Record the iPhone model, iOS version, app source revision, and pass/fail evidence.
Use non-personal test footage.

1. **Navigation:** Open an Event Card → Track Stats. The chooser offers Track
   Stats, Live Taps, and Record Moments. Open and close each. Existing stats and
   cheers remain intact. Prep and Share remain available. Cancel the chooser
   after returning from Record Moments: it must not reopen the editor. Open
   Record Moments directly from the dashboard with an empty schedule and offline.
2. **Choose:** Pick a local video, an iCloud-only video, a silent video, and a
   sub-second video. Cancel selection with an existing preview: it must remain
   intact. Cancel an iCloud import and immediately choose another video: a late
   result must not replace the new selection. Unavailable/corrupt media must
   show an error rather than leave the editor permanently busy.
3. **Camera and permissions:** Deny Camera, then Microphone separately. The
   message must explain Settings and keep Choose Video usable. Grant both and
   record portrait, landscape-left, and landscape-right clips with spoken first
   and last selected markers. Cancel recording without losing the existing clip.
4. **Trim:** Use only the blue Start and orange End sliders below the thumbnail
   strip; the strip is a visual guide, not a second control. Move each slider
   and confirm its time label and the blue-to-orange selected-range gradient
   update. Select 15 seconds beginning in the middle of a longer clip and
   confirm preview starts and stops there. Select a shorter segment, including
   the end of the source. Check a front-camera mirrored source, HEVC/HDR source,
   variable-frame-rate source, and slow-motion source. Do not assume simulator
   H.264 tests establish these device-specific decoding paths. With VoiceOver,
   confirm the sliders announce Footage start and Footage end, their current
   values, and which endpoint stays fixed while adjusting.
5. **Intro videos:** Try all seven choices: Clutch, Domination, Game Changer,
   Highlight, Hustle, Locked In, and Unstoppable. Confirm each plays before the
   action and the poster matches its animation. Test portrait and landscape
   source clips; the full intro should remain centered and uncropped. Each
   intro is 2.5 seconds. With Stadium Ignition enabled, confirm the cue plays
   only during the intro and fades before original clip audio begins. Confirm
   the embedded audio from the supplied intro files is not played.
    **PIXL Arena frame:** Leave the optional frame off and confirm the export is
    unchanged. Before exporting, turn it on and confirm the matching frame
    appears over the selected footage in the editor preview; turn it off and
    confirm it disappears immediately without changing the source video. Turn it
    on again and test portrait, landscape, 4:3, and square footage.
    The blue-and-lime rim must surround the entire selected action, with the
    full video fitted inside the opening. It must never frame the animated
    intro or the intro-only editor preview. Confirm the source audio and full
    selected footage remain intact, and the finished preview, Photos save, and
    shared MP4 all include the rim.
    The preview player should follow the video's proportions, without an
    extra fixed-height black box. Turn the frame off after an export and
    confirm the previous framed output is cleared before saving or sharing.
6. **Actual files:** Save a full selection to Photos. Inspect the saved MP4
   with QuickTime/`ffprobe`: duration should be about 17.5 seconds (within a frame),
   video must be upright, and the selected first/last spoken markers must
   remain audible and in sync. Repeat the export with all seven intros. The
   Stadium Ignition cue must stop before source audio begins; with the cue
   disabled, preserve only the selected source audio after the intro. Silent
   source clips are allowed.
7. **Photos:** Deny add permission and confirm a helpful retry/Settings path.
   Grant add-only permission and save successfully. Confirm Photos contains the
   finished MP4, not the original or a poster. Retry after denied permission.
   Trigger a storage-full failure if feasible; do not show success on failure.
8. **Share:** Use the native share sheet to send the file to Messages, AirDrop,
   and Files. Open the received MP4 and repeat duration/orientation/audio checks.
   Cancel the sheet and retry; the preview/file must remain available. The
   editor must retain its file while an activity is using it.
9. **Lifecycle:** Cancel export, retry, and change the intro after a finished
   preview exists. Confirm the old output is removed, preview switches to the
   newly selected intro, and saving/sharing waits for a new export. Reselecting the same intro
   also clears the prior output. Repeat on the first clip after an Xcode rebuild:
   create Clutch, select Domination, recreate, then select Game Changer and
   recreate. Verify both the displayed finished-intro name and the actual
   animation in preview and saved MP4 match the newest choice, without deleting
   the installed app or its data. Background during export and return. A
   failed/interrupted export must keep the source intact and allow retry. Close
   the editor and inspect its
    `tmp/PIXL-Moment-*` workspace: source copies, generated files, and outputs
    should be removed. Bundled intro videos stay with the installed app. Saved
    Photos and shared copies must remain. The app must make no
    clip-upload request and create no persistent moment library.
10. **Thumbnail generation under load:** On a supported iPhone, use a local,
    non-personal video close to the 120 MB source limit. While the private
    thumbnail timeline is preparing, scroll the editor and repeatedly adjust
    both sliders. Confirm controls continue responding, the selected times and
    gradient update, and the app remains usable until thumbnails finish.
    Record the source file size and whether any stall, memory warning, or crash
    occurred.
11. **Replace during thumbnail generation:** Start with a long source that takes
    several seconds to prepare, then choose a visibly different clip before the
    first timeline finishes. Once the new source is accepted, confirm the old
    frames do not reappear and all visible thumbnails belong to the new clip.
    Repeat with a quick second replacement if possible; the final timeline must
    match only the last accepted source.
12. **Close during thumbnail generation:** Open a long source and tap Done while
    its timeline is still preparing. Confirm the editor closes and thumbnail
    decoding stops; reopening Record Moments must not show frames from the
    dismissed session. Confirm no Photos save or share sheet was started by the
    thumbnail task. In a separate pass, export a clip and verify the existing
    Photos save and native share flows still work.

Record results for checks 10–12 here before release:

| iPhone / iOS | Source size | Check 10 | Check 11 | Check 12 | Notes |
| --- | ---: | --- | --- | --- | --- |
| Not run in this workspace | — | Pending | Pending | Pending | Requires physical iPhone |

The temporary system camera/picker files are device-managed. PIXL owns and
removes only its copied workspace and the camera's returned disposable capture;
it never deletes a source asset from Photos.
