/// <reference lib="webworker" />
import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';

// MODNet and its converted weights are Apache-2.0 licensed. Only model files
// are downloaded; the athlete's image never leaves this worker.
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
let ready: Promise<Awaited<ReturnType<typeof load>>> | null = null;
async function load() {
  const [model, processor] = await Promise.all([
    AutoModel.from_pretrained('Xenova/modnet', { dtype: 'fp32', device: 'wasm' }),
    AutoProcessor.from_pretrained('Xenova/modnet'),
  ]);
  return { model, processor };
}
self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    self.postMessage({ status: 'Downloading the background-removal model…' });
    ready ??= load().catch((error) => { ready = null; throw error; });
    const { model, processor } = await ready;
    self.postMessage({ status: 'Separating the athlete from the background…' });
    const image = await RawImage.fromBlob(event.data);
    const { pixel_values } = await processor(image);
    const { output } = await model({ input: pixel_values });
    const mask = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(image.width, image.height);
    const source = await createImageBitmap(event.data);
    try {
      const canvas = new OffscreenCanvas(source.width, source.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This device cannot prepare a transparent image.');
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, source.width, source.height);
      let minX = source.width, minY = source.height, maxX = -1, maxY = -1;
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const i = y * source.width + x;
        const alpha = mask.data[i * mask.channels];
        pixels.data[i * 4 + 3] = Math.round(pixels.data[i * 4 + 3] * alpha / 255);
        if (alpha > 20) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      if (maxX < minX || maxY < minY) throw new Error('No usable athlete was found. Try a clearer portrait or upload a transparent cutout.');
      context.putImageData(pixels, 0, 0);
      const crop = new OffscreenCanvas(maxX - minX + 1, maxY - minY + 1);
      crop.getContext('2d')!.drawImage(canvas, minX, minY, crop.width, crop.height, 0, 0, crop.width, crop.height);
      self.postMessage({ blob: await crop.convertToBlob({ type: 'image/png' }) });
    } finally { source.close(); }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Background removal failed.' });
  }
};