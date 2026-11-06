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
4. **Trim:** Select 15 seconds beginning in the middle of a longer clip. Preview
   must start and stop at that selection. Select a shorter segment, including
   the end of the source. Check a front-camera mirrored source, HEVC/HDR source,
   variable-frame-rate source, and slow-motion source. Do not assume simulator
   H.264 tests establish these device-specific decoding paths.
5. **Artwork:** Export with each of the ten original-derived shoutouts. Full
   square artwork must remain upright and readable, with no edge cropping.
   Inspect landscape and portrait at phone viewing size. Confirm the intro
   gently fades and scales in, reaches the complete artwork, and precedes rather
    than covers or replaces the selected action. Also select **Clutch · Animated**:
    verify the bundled 16:9 video plays in landscape and remains fully visible,
    centered with black space above/below in portrait rather than cropping its
    text. Its intro is fixed at 2.5 seconds. Turn the sound-effect toggle on and
    off; when enabled, the whoosh and hit should play only during the intro.
6. **Actual files:** Save a full selection to Photos. Inspect the saved MP4
   with QuickTime/`ffprobe`: duration should be about 17 seconds (within a frame),
   video must be upright, and the selected first/last spoken markers must
   remain audible and in sync. For **Clutch · Animated**, confirm the short
   effect ends before original audio begins; no instrumental plays under the
   action. With the effect disabled, the intro has no added sound. A 4-second
   selection produces about 6 seconds total with the default still intro.
   Repeat with the adjustable one- and three-second still intros: 15 seconds of
   footage must produce about 16 and 18 seconds respectively. The Clutch
   animated video intro plus 15 seconds of footage should produce about
   17.5 seconds. Silent source clips are allowed.
7. **Photos:** Deny add permission and confirm a helpful retry/Settings path.
   Grant add-only permission and save successfully. Confirm Photos contains the
   finished MP4, not the original or a poster. Retry after denied permission.
   Trigger a storage-full failure if feasible; do not show success on failure.
8. **Share:** Use the native share sheet to send the file to Messages, AirDrop,
   and Files. Open the received MP4 and repeat duration/orientation/audio checks.
   Cancel the sheet and retry; the preview/file must remain available. The
   editor must retain its file while an activity is using it.
9. **Lifecycle:** Cancel export, retry, change the artwork, then export again.
   Background during export and return. A failed/interrupted export must keep
   the source intact and allow retry. Close the editor and inspect its
    `tmp/PIXL-Moment-*` workspace: source copies, generated still intros, and
    outputs should be removed. The bundled Clutch video stays with the installed
    app. Saved Photos and shared copies must remain. The app must make no
    clip-upload request and create no persistent moment library.
10. **Thumbnail generation under load:** On a supported iPhone, use a local,
    non-personal video close to the 120 MB source limit. While the private
    thumbnail timeline is preparing, scroll the editor and repeatedly adjust
    both trim handles/sliders. Confirm controls continue responding, the
    selected times update, and the app remains usable until thumbnails finish.
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
