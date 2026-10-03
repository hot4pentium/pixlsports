import sharp from "sharp";

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_DIMENSION = 12_000;
const MAX_OUTPUT_DIMENSION = 2_048;
const FORMAT_CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export class InvalidAthleteInvitePhotoError extends Error {
  constructor(message = "Choose a valid JPG, PNG, or WebP image with safe dimensions.") {
    super(message);
    this.name = "InvalidAthleteInvitePhotoError";
  }
}

export async function sanitizeAthleteInvitePhoto(input: Buffer, declaredContentType: string, cutout = false) {
  if (!input.length || input.length > 5 * 1024 * 1024) throw new InvalidAthleteInvitePhotoError();
  try {
    const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const metadata = await source.metadata();
    if (!metadata.format || FORMAT_CONTENT_TYPES[metadata.format] !== declaredContentType
      || !metadata.width || !metadata.height
      || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > MAX_INPUT_PIXELS
      || (metadata.pages ?? 1) !== 1) {
      throw new InvalidAthleteInvitePhotoError();
    }
    if (cutout) {
      const stats = await source.stats();
      const alpha = metadata.hasAlpha ? stats.channels.at(-1) : null;
      if (!alpha || alpha.min > 30 || alpha.max < 200) {
        throw new InvalidAthleteInvitePhotoError("Choose a transparent athlete PNG or WebP with a visible subject.");
      }
    }
    const prepared = cutout ? source.trim({ background: "#00000000", threshold: 10 }) : source;
    const contents = await prepared.rotate()
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
    return { contents, contentType: "image/webp" as const };
  } catch (error) {
    if (error instanceof InvalidAthleteInvitePhotoError) throw error;
    throw new InvalidAthleteInvitePhotoError();
  }
}

export async function createAthleteInviteIcon(photo: Buffer | null, size: 192 | 512) {
  const source = photo ?? Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" rx="${size * 0.2}" fill="#10293b"/><circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.31}" fill="#f5a623"/><path d="M${size * 0.37} ${size * 0.5}h${size * 0.26}m-${size * 0.13}-${size * 0.13}v${size * 0.26}" stroke="#10293b" stroke-width="${size * 0.055}" stroke-linecap="round"/></svg>`,
  );
  return sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(size, size, { fit: "cover", position: "attention" })
    .png()
    .toBuffer();
}