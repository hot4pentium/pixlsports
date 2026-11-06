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
  assert.match(exporter, /at: CMTimeAdd\(introTime, CMTimeSubtract/);
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
test("Clutch Animated is a compact local video intro with portrait and landscape checks", () => {
  const plan = read("NativeMomentPlan.swift");
  assert.match(plan, /case clutch, clutchAnimated/);
  assert.match(plan, /Clutch · Animated/);
  assert.match(plan, /RecordMomentClutch/);
  assert.match(model, /Bundle\.main\.url\(forResource: resource, withExtension: "mp4"\)/);
  assert.match(model, /shoutoutVideo: shoutoutVideo/);
  assert.match(view, /Animated video intro/);
  assert.match(view, /shoutout\.videoResource != nil/);
  const clipURL = new URL("../PIXL Sports/RecordMomentClutch.mp4", import.meta.url);
  const clip = readFileSync(clipURL);
  assert.ok(clip.length < 350_000, `Bundled sample should stay below 350 KB: ${clip.length} bytes`);
  assert.equal(clip.subarray(4, 8).toString(), "ftyp", "Animated shoutout must be a valid local MP4");
  const appleChecks = readFileSync(new URL("NativeMomentExportChecks.swift", import.meta.url), "utf8");
  assert.match(appleChecks, /animated-clutch-landscape/);
  assert.match(appleChecks, /animated-clutch-portrait/);
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
