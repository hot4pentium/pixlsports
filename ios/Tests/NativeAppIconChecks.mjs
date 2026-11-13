import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const iconSet = new URL("../PIXL Sports/Assets.xcassets/AppIcon.appiconset/", import.meta.url);
const contents = JSON.parse(readFileSync(new URL("Contents.json", iconSet), "utf8"));
const project = readFileSync(new URL("../PIXL Sports.xcodeproj/project.pbxproj", import.meta.url), "utf8");

function pngDimensions(filename) {
  const png = readFileSync(new URL(filename, iconSet));
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a", `${filename} must be a PNG`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("the app icon catalog contains the required iPhone and iPad sizes", () => {
  const expected = new Map([
    ["AppIcon-60@2x.png", [120, 120]],
    ["AppIcon-60@3x.png", [180, 180]],
    ["AppIcon-76.png", [76, 76]],
    ["AppIcon-76@2x.png", [152, 152]],
    ["AppIcon-83.5@2x.png", [167, 167]],
    ["AppIcon-1024.png", [1024, 1024]],
  ]);

  for (const image of contents.images) {
    const size = expected.get(image.filename);
    assert.ok(size, `Unexpected icon catalog entry: ${image.filename}`);
    assert.deepEqual(pngDimensions(image.filename), size, `${image.filename} dimensions`);
    expected.delete(image.filename);
  }
  assert.deepEqual([...expected.keys()], [], "All required app icon sizes must be cataloged");
});

test("both app configurations set the generated Info.plist icon name", () => {
  assert.equal((project.match(/INFOPLIST_KEY_CFBundleIconName = AppIcon;/g) ?? []).length, 2);
  assert.equal((project.match(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g) ?? []).length, 2);
});
