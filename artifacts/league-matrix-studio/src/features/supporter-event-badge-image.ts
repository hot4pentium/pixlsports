/** Flatten badge artwork and live event text into the image used by native image previews. */
export async function renderSupporterEventBadgeImage({
  src, category, title, dateTime,
}: {
  src: string;
  category: string;
  title: string;
  dateTime: string;
}): Promise<string> {
  const artwork = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Event badge artwork could not be loaded.'));
    image.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = artwork.naturalWidth;
  canvas.height = artwork.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Event badge image could not be prepared.');
  const width = canvas.width;
  const height = canvas.height;
  context.drawImage(artwork, 0, 0);
  context.textBaseline = 'middle';

  const print = (text: string, top: number, boxHeight: number, color: string, initialSize: number, maxLines = 1) => {
    const left = width * 0.118;
    const boxWidth = width * 0.82;
    const padding = width * 0.016;
    const availableWidth = boxWidth - padding * 2;
    const availableHeight = height * boxHeight;
    context.fillStyle = '#fff';
    context.fillRect(left, height * top, boxWidth, availableHeight);
    let size = initialSize * width / 1174;
    let lines: string[] = [];
    for (;;) {
      context.font = `900 ${size}px Arial, sans-serif`;
      lines = [''];
      for (const word of text.split(/\s+/)) {
        const last = lines.length - 1;
        const candidate = lines[last] ? `${lines[last]} ${word}` : word;
        if (lines[last] && context.measureText(candidate).width > availableWidth) lines.push(word);
        else lines[last] = candidate;
      }
      if (lines.length <= maxLines
        && lines.every((line) => context.measureText(line).width <= availableWidth)
        && lines.length * size * 0.98 <= availableHeight) break;
      size *= 0.95;
      if (size < 1) throw new Error('Event badge text could not be fitted.');
    }
    context.fillStyle = color;
    const lineHeight = size * 0.98;
    const center = height * top + availableHeight / 2;
    lines.forEach((line, index) => {
      context.fillText(line, left + padding, center + (index - (lines.length - 1) / 2) * lineHeight);
    });
  };

  print(category.toUpperCase(), 0.27, 0.055, '#3474d3', 76);
  print(title, 0.313, 0.15, '#0b1f3a', 112, 2);
  print(dateTime, 0.584, 0.058, '#0b1f3a', 76);
  return canvas.toDataURL('image/png');
}
