import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url), "utf8");
const exporter = read("NativeMomentExporter.swift");
const model = read("NativeMomentModel.swift");
const picker = read("NativeMomentPickers.swift");
const view = read("NativeRecordMomentsView.swift");
const tracking = read("NativeEventTrackingPanel.swift");
test("Record Moments is the third choice without replacing Prep or Share", () => {
  for (const mode of ["statTracker", "liveTaps", "recordMoments"]) {
    assert.ok(tracking.includes(`modeChoice(.${mode})`));
  }
  assert.match(read("NativeEventStepBar.swift"), /onSelect\(\.prep\)/);
  assert.match(read("NativeEventStepBar.swift"), /onSelect\(\.share\)/);
  assert.match(read("ContentView.swift"), /heroDestination = \.recordMoments/);
  assert.equal((read("ContentView.swift").match(/accessibilityIdentifier\("dashboard-record-moments"\)/g) ?? []).length, 1);
  assert.match(tracking, /recordMomentsAfterPicker = true/);
  assert.match(tracking, /onDismiss:/);
});
test("local-only output preserves audio and orientation with no frame cropping", () => {
  assert.match(exporter, /load\(\.preferredTransform\)/);
  assert.match(exporter, /shoutoutVideo: URL\? = nil/);
  assert.match(exporter, /introAvailable\.duration\.seconds/);
  assert.match(exporter, /introPreferredTransform/);
  assert.match(exporter, /introInstruction\.backgroundColor/);
  assert.match(exporter, /CMTimeRangeGetIntersection\(range, otherRange: available\)/);
  assert.match(exporter, /audioStart = CMTimeAdd\(introTime, CMTimeSubtract/);
  assert.match(exporter, /of: sourceAudio, at: audioStart/);
  assert.match(exporter, /insertTimeRange\(range, of: video, at: introTime\)/);
  assert.match(exporter, /min\(size.width, size.height\)/);
  assert.match(exporter, /finished.load\(\.duration\)/);
  assert.match(exporter, /context\.setAlpha\(CGFloat\(opacity\)\)/);
  assert.match(exporter, /0\.92 \+ 0\.08 \* eased/);
  assert.match(exporter, /setVolumeRamp/);
  for (const code of [exporter, model, picker, view]) {
    assert.doesNotMatch(code, /URLSession|NativeAccountLinkClient|CKAsset/i, "No hosting in media pipeline");
  }
});
test("original video audio fades in at its actual start without moving the footage", () => {
  const sourceAudio = exporter.slice(exporter.indexOf("for sourceAudio in"), exporter.indexOf("if let introMusicURL"));
  assert.match(sourceAudio, /min\(0\.35, overlap\.duration\.seconds\)/);
  assert.match(sourceAudio, /fromStartVolume: 0,[\s\S]*?toEndVolume: 1/);
  assert.match(sourceAudio, /CMTimeRange\(start: audioStart, duration: sourceFadeDuration\)/);
  assert.match(sourceAudio, /setVolume\(1, at: CMTimeAdd\(audioStart, sourceFadeDuration\)\)/);
  assert.match(exporter, /insertTimeRange\(range, of: video, at: introTime\)/);
  const appleChecks = readFileSync(new URL("NativeMomentExportChecks.swift", import.meta.url), "utf8");
  assert.match(appleChecks, /checkSourceFadeIn/);
  assert.match(appleChecks, /Source audio did not fade in gently/);
});
test("animated shoutout music fades out before the original audio", () => {
  assert.match(model, /@Published var introMusicEnabled = true/);
  assert.match(model, /func introMusicSelectionChanged\(\)/);
  assert.match(model, /RecordMomentClutchIntroMusic/);
  assert.match(model, /if introMusicEnabled, shoutout\.videoResource != nil/);
  assert.doesNotMatch(model, /introSoundEffectEnabled|RecordMomentClutchSFX/);
  assert.match(view, /record-moments-music-toggle/);
  assert.match(view, /fades out before your original video audio begins/);
  assert.doesNotMatch(view, /Add intro sound effect|whoosh and soft hit/);
  assert.match(exporter, /introMusicURL: URL\? = nil/);
  assert.match(exporter, /plan\.intro - 0\.12/);
  assert.match(exporter, /of: musicSource/);
  const musicURL = new URL("../PIXL Sports/RecordMomentClutchIntroMusic.m4a", import.meta.url);
  const bytes = readFileSync(musicURL);
  assert.ok(bytes.length < 75_000, `Intro music should stay small: ${bytes.length} bytes`);
  assert.equal(bytes.subarray(4, 8).toString(), "ftyp", "Intro music must be a valid local M4A file");
  assert.equal(existsSync(new URL("../PIXL Sports/RecordMomentClutchSFX.m4a", import.meta.url)), false,
    "The previous intro effect should no longer be bundled");
  assert.equal(existsSync(new URL("../PIXL Sports/RecordMomentMusic.m4a", import.meta.url)), false,
    "The instrumental music bed should no longer be bundled");
  const appleChecks = readFileSync(new URL("NativeMomentExportChecks.swift", import.meta.url), "utf8");
  assert.match(appleChecks, /intro music fades before source audio/);
  assert.match(appleChecks, /Intro music overlapped the original clip audio/);
});
test("animated shoutouts are compact local video intros with portrait and landscape checks", () => {
  const plan = read("NativeMomentPlan.swift");
  assert.match(plan, /case clutch, clutchAnimated, domination, dominationAnimated/);
  assert.match(plan, /Clutch · Animated/);
  assert.match(plan, /Domination · Animated/);
  assert.match(plan, /case \.dominationAnimated: return "Moment-domination"/);
  assert.match(plan, /RecordMomentClutch/);
  assert.match(plan, /RecordMomentDomination/);
  assert.match(plan, /RecordMomentClutchPortrait/);
  assert.match(plan, /RecordMomentDominationPortrait/);
  assert.match(model, /Bundle\.main\.url\(forResource: resource, withExtension: "mp4"\)/);
  assert.match(model, /portraitVideoResource/);
  assert.match(model, /shoutoutVideoPortrait: portraitShoutoutVideo/);
  assert.match(exporter, /if oriented\.height > oriented\.width/);
  assert.match(exporter, /shoutoutVideoPortrait/);
  assert.match(model, /shoutoutVideo: shoutoutVideo/);
  assert.match(view, /Animated video intro/);
  assert.match(view, /shoutout\.videoResource != nil/);
  assert.match(view, /music cue plays only with animated shoutout intros/);
  const appleChecks = readFileSync(new URL("NativeMomentExportChecks.swift", import.meta.url), "utf8");
  for (const name of [
    "RecordMomentClutch.mp4", "RecordMomentDomination.mp4",
    "RecordMomentClutchPortrait.mp4", "RecordMomentDominationPortrait.mp4"
  ]) {
    const clip = readFileSync(new URL(`../PIXL Sports/${name}`, import.meta.url));
    assert.ok(clip.length < 350_000, `${name} should stay below 350 KB: ${clip.length} bytes`);
    assert.equal(clip.subarray(4, 8).toString(), "ftyp", `${name} must be a valid local MP4`);
  }
  assert.match(appleChecks, /animated-clutch-portrait/);
  assert.match(appleChecks, /centeredContentFrame/);
  assert.match(appleChecks, /animated-clutch-landscape/);
  assert.match(appleChecks, /PASS: animated Domination with Stadium Ignition music/);
});
test("the exact exported MP4 is previewed, saved, and shared", () => {
  const exportFlow = model.slice(model.indexOf("func export()"), model.indexOf("func save()"));
  const saveFlow = model.slice(model.indexOf("func save()"), model.indexOf("func stopPlayback()"));
  assert.match(exportFlow, /output = url/);
  assert.match(exportFlow, /setPreview\(url: url, start: 0, end: plan\.total\)/);
  assert.match(saveFlow, /creationRequestForAssetFromVideo\(atFileURL: output\)/);
  assert.match(view, /NativeMomentShareSheet\(url: output\)/);
  assert.match(view, /Finished MP4 preview/);
});
test("file representations are copied before callbacks return and errors are explicit", () => {
  assert.match(picker, /loadFileRepresentation/);
  assert.match(picker, /copyItem\(at: url, to: target\)/);
  assert.match(picker, /imagePickerControllerDidCancel/);
  assert.match(model, /id == pickerID/);
  assert.match(model, /importProgress\?\.cancel/);
  assert.match(model, /removeItem\(at: directory\)/);
  assert.match(exporter, /cancelExport\(\)/);
  assert.match(exporter, /if !success.*removeItem\(at: output\)/);
});
test("Photos and native sharing are explicit and camera has both permissions", () => {
  assert.match(model, /requestAuthorization\(for: \.addOnly\)/);
  assert.match(model, /creationRequestForAssetFromVideo/);
  assert.match(picker, /UIActivityViewController\(activityItems: \[url\]/);
  assert.match(view, /requestAccess\(for: \.video\)/);
  assert.match(view, /requestAccess\(for: \.audio\)/);
  assert.match(view, /Sharing cancelled/);
  assert.match(model, /This source has no audio/);
  const project = readFileSync(new URL("../PIXL Sports.xcodeproj/project.pbxproj", import.meta.url), "utf8");
  assert.equal((project.match(/INFOPLIST_KEY_NSMicrophoneUsageDescription/g) ?? []).length, 2);
});
test("long-video trimming uses local thumbnails and bounded accessible handles", () => {
  assert.match(model, /AVAssetImageGenerator\(asset: AVURLAsset\(url: url\)\)/);
  assert.match(model, /generateCGImagesAsynchronously\(forTimes:/);
  assert.match(model, /withTaskCancellationHandler/);
  assert.match(model, /cancelAllCGImageGeneration\(\)/);
  assert.match(model, /maximumSize = CGSize\(width: 180, height: 180\)/);
  assert.match(model, /thumbnailRequestID/);
  assert.match(model, /thumbnailTask\?\.cancel\(\)/);
  assert.match(model, /self\.thumbnailRequestID == requestID/);
  assert.match(model, /func shutdown\(\)/);
  assert.match(view, /model\.shutdown\(\)/);
  assert.match(model, /func setTrimStart/);
  assert.match(model, /func setTrimEnd/);
  assert.match(model, /NativeMomentPlan\.maximumFootage/);
  assert.match(view, /record-moments-trim-timeline/);
  assert.match(view, /record-moments-start-handle/);
  assert.match(view, /record-moments-end-handle/);
  assert.match(view, /accessibilityAdjustableAction/);
  assert.match(view, /record-moments-start/);
  assert.match(view, /record-moments-duration/);
});
test("unavailable thumbnail frames keep their timeline positions without blocking trim", () => {
  const generation = model.slice(model.indexOf("private func generateThumbnails"), model.indexOf("private func clearOutput"));
  assert.match(generation, /var images = Array<UIImage\?>\(repeating: nil, count: count\)/);
  assert.match(generation, /images\[index\] = image/);
  assert.doesNotMatch(generation, /images\.append/);
  assert.match(generation, /self\.thumbnails = images[\s\S]*?self\.isGeneratingThumbnails = false/);
  assert.match(view, /Some thumbnail previews aren.t available[\s\S]*?trim with the timeline or sliders/);
  assert.match(view, /Thumbnail previews aren.t available[\s\S]*?trim with the sliders/);
  const trim = view.slice(view.indexOf("private var trimSection"), view.indexOf("private var shoutoutSection"));
  const timeline = view.slice(view.indexOf("private struct NativeMomentTrimTimeline"));
  assert.match(timeline, /title: "START"/);
  assert.match(timeline, /title: "END"/);
  assert.match(trim, /model\.thumbnails\.allSatisfy/);
  assert.match(trim, /record-moments-trim-timeline/);
  assert.match(trim, /record-moments-start/);
  assert.match(trim, /record-moments-duration/);
  assert.match(timeline, /accessibilityAdjustableAction/);
});
test("each new source requires a fresh shoutout selection", () => {
  assert.match(model, /@Published var shoutout: NativeMomentShoutout\?/);
  assert.match(model, /guard let shoutout else \{ return nil \}/);
  assert.match(model, /shoutout = nil/);
  assert.match(model, /guard let source, let plan, let shoutout, !busy else \{ return \}/);
  assert.match(view, /Previous choices won.t carry over/);
});
test("replacing a preview remounts the video player instead of showing a stale frame", () => {
  assert.match(model, /@Published private\(set\) var previewID = UUID\(\)/);
  const release = model.slice(model.indexOf("private func releasePlayer()"), model.indexOf("private func setPreview("));
  assert.match(release, /previewID = UUID\(\)/);
  assert.match(release, /replaceCurrentItem\(with: nil\)/);
  assert.match(view, /VideoPlayer\(player: player\)[\s\S]*?\.id\(model\.previewID\)/);
  const musicChange = model.slice(model.indexOf("func introMusicSelectionChanged()"), model.indexOf("func setTrimStart("));
  assert.match(musicChange, /clearOutput\(\)[\s\S]*?updatePreview\(\)/);
});
test("all ten original-derived optimized graphics are full-size and bundled", () => {
  const root = new URL("../PIXL Sports/Assets.xcassets/", import.meta.url);
  const assets = readdirSync(root).filter(name => name.startsWith("Moment-"));
  assert.equal(assets.length, 10);
  let bytes = 0;
  for (const name of assets) {
    const dir = new URL(`${name}/`, root);
    const manifest = JSON.parse(readFileSync(new URL("Contents.json", dir)));
    const jpg = new URL(manifest.images[0].filename, dir);
    const buffer = readFileSync(jpg);
    assert.equal(buffer[0], 0xff);
    assert.equal(buffer[1], 0xd8);
    let dimensions;
    for (let offset = 2; offset < buffer.length - 9;) {
      assert.equal(buffer[offset], 0xff);
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        dimensions = [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 7)];
        break;
      }
      offset += 2 + length;
    }
    assert.deepEqual(dimensions, [1024, 1024], `Artwork was resized or cropped: ${name}`);
    bytes += statSync(jpg).size;
  }
  assert.ok(bytes < 3_000_000, `Assets too large: ${bytes}`);
});
