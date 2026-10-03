export function hasUsableTransparency(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): boolean {
  const pixelCount = width * height;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || rgba.length !== pixelCount * 4
  ) return false;

  let transparentPixels = 0;
  let visiblePixels = 0;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] <= 8) transparentPixels += 1;
    if (rgba[index] >= 32) visiblePixels += 1;
  }

  return transparentPixels >= Math.max(1, pixelCount * 0.001)
    && visiblePixels >= pixelCount * 0.005;
}