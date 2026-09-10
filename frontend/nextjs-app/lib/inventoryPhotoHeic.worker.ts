import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

// This worker owns the entire decoder lifetime and is terminated by its caller.
// No codec, source bytes, or raw pixel allocation enters the server bundle.
let started = false;
self.onmessage = async ({ data }: MessageEvent<{ blob?: Blob }>) => {
  if (started) return;
  started = true;
  let libheif: Awaited<ReturnType<typeof createLibheif>> | undefined;
  let decoder: InstanceType<Awaited<ReturnType<typeof createLibheif>>['HeifDecoder']> | undefined;
  let images: ReturnType<NonNullable<typeof decoder>['decode']> = [];
  try {
    const blob = data?.blob;
    if (!(blob instanceof Blob) || !blob.size || blob.size > 30 * 1024 * 1024) throw new Error('Choose a photo under 30 MB.');
    libheif = await createLibheif({ print() {}, printErr() {} });
    decoder = new libheif.HeifDecoder();
    images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
    if (images.length !== 1 || !images[0].is_primary()) throw new Error('Choose a single still HEIC/HEIF photo, or take a new photo.');
    const image = images[0], width = image.get_width(), height = image.get_height();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 50_000_000) {
      throw new Error('Choose a photo no larger than 50 megapixels. Standard iPhone 12 MP and 48 MP photos are supported.');
    }
    const pixels = await new Promise<ImageData>((resolve, reject) => {
      image.display(new ImageData(width, height), result => result ? resolve(result) : reject(new Error('This HEIC photo could not be decoded. Choose the original photo again.')));
    });
    // libheif has already applied HEIF orientation. Resize without another rotation.
    const scale = Math.min(1, 1400 / Math.max(width, height));
    const bitmap = await createImageBitmap(pixels, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: 'high' });
    (self as unknown as { postMessage: (value: unknown, transfer: Transferable[]) => void }).postMessage({ bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'This HEIC photo could not be opened. Choose the original photo again.' });
  } finally {
    for (const image of images) image.free();
    if (decoder?.decoder && libheif) libheif.heif_context_free(decoder.decoder);
  }
};
