import { readFileSync, readdirSync, statSync } from "node:fs";
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
  assert.match(exporter, /CMTimeRangeGetIntersection\(range, available\)/);
  assert.match(exporter, /at: CMTimeAdd\(introTime, CMTimeSubtract/);
  assert.match(exporter, /insertTimeRange\(range, of: video, at: introTime\)/);
  assert.match(exporter, /min\(size.width, size.height\)/);
  assert.match(exporter, /finished.load\(\.duration\)/);
  for (const code of [exporter, model, picker, view]) {
    assert.doesNotMatch(code, /URLSession|NativeAccountLinkClient|CKAsset/i, "No hosting in media pipeline");
  }
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
  assert.match(model, /copyCGImage\(at: time/);
  assert.match(model, /maximumSize = CGSize\(width: 180, height: 180\)/);
  assert.match(model, /thumbnailRequestID/);
  assert.match(model, /thumbnailTask\?\.cancel\(\)/);
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
