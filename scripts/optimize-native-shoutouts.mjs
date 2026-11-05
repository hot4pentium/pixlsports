// Rebuild bundled derivatives from the ten ORIGINAL PNGs, never the overview.
// Uses the existing Sharp dependency without adding a runtime dependency to iOS.
import { globSync } from "node:fs";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
const sharpModule = globSync("node_modules/.pnpm/sharp@*/node_modules/sharp/dist/index.mjs")[0]
  ?? globSync("node_modules/.pnpm/sharp@*/node_modules/sharp/lib/index.js")[0];
if (!sharpModule) throw new Error("Install workspace dependencies first.");
const { default: sharp } = await import(resolve(sharpModule));
const originals = globSync("attached_assets/*_1793840947979.png").sort();
if (originals.length !== 10) throw new Error("Expected exactly ten original shoutout PNGs.");
let inputBytes = 0;
let outputBytes = 0;
for (const path of originals) {
  const name = path.match(/\/\d+_(\w+)_1793840947979\.png$/)?.[1];
  if (!name) throw new Error(`Unexpected original: ${path}`);
  const source = await readFile(path);
  const metadata = await sharp(source).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1024) throw new Error(`Not an original square: ${path}`);
  // Keep the entire 1024-square artwork and fine text; only change compression.
  const jpg = await sharp(source).jpeg({ quality: 86, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
  const dir = `ios/PIXL Sports/Assets.xcassets/Moment-${name}.imageset`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/artwork.jpg`, jpg);
  await writeFile(`${dir}/Contents.json`, JSON.stringify({
    images: [{ filename: "artwork.jpg", idiom: "universal" }],
    info: { author: "xcode", version: 1 }
  }, null, 2) + "\n");
  inputBytes += (await stat(path)).size;
  outputBytes += jpg.length;
  console.log(`${name}: ${jpg.length} bytes, full 1024×1024`);
}
console.log(`Originals ${inputBytes}; bundled ${outputBytes}; reduction ${(100 * (1 - outputBytes / inputBytes)).toFixed(1)}%`);
