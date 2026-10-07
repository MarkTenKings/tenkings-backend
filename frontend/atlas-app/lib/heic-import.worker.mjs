import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import { decodeHeicPixels } from './heic-decode.mjs';

const MAX_BYTES = 50 * 1024 * 1024;
const decodeErrors = {
    HEIC_INVALID: 'This file is not a supported HEIC/HEIF photograph. Select the original photo again.',
    HEIC_TOO_LARGE: 'This HEIC photo exceeds the image size limit. Choose a photo under 64 megapixels and 50 MB.',
    HEIC_SEQUENCE_UNSUPPORTED: 'Choose a single still HEIC photograph. Image sequences are not supported.',
    HEIC_MULTIPLE_IMAGES: 'This HEIC file contains multiple photographs. Export one still photo for this side of the card.',
    HEIC_DEPTH_UNSUPPORTED: 'This HEIC photo uses an unsupported bit depth. Export an 8-bit SDR PNG and select it again.',
    HEIC_COLOR_UNSUPPORTED: 'This HEIC photo uses a color profile that ATLAS cannot preserve yet. Export a color-managed PNG and select it again.',
    HEIC_DECODE_FAILED: 'This HEIC photograph could not be decoded. Select the original photo again.'
};
let started = false;
self.onmessage = async ({ data }) => {
    if (started) return;
    started = true;
    let canvas;
    try {
        const file = data?.file;
        if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_BYTES) throw new Error('Each photograph must be between 1 byte and 50 MB.');
        self.postMessage({ progress: 'Reading HEIC' });
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength !== file.size) throw new Error('The photograph changed while reading. Select it again.');
        const libheif = await createLibheif({ print() {}, printErr() {} });
        self.postMessage({ progress: 'Decoding full-resolution image' });
        const decoded = await decodeHeicPixels(bytes, libheif);
        canvas = new OffscreenCanvas(decoded.width, decoded.height);
        const context = canvas.getContext('2d', { colorSpace: decoded.colorSpace });
        if (!context || context.getContextAttributes().colorSpace !== decoded.colorSpace) {
            throw new Error('This browser cannot preserve this HEIC photo’s colors. Use an up-to-date Chrome or Safari browser.');
        }
        const pixels = new ImageData(decoded.data, decoded.width, decoded.height, { colorSpace: decoded.colorSpace });
        if (pixels.colorSpace !== decoded.colorSpace) throw new Error('This browser cannot preserve this HEIC photo’s colors. Update your browser and try again.');
        context.putImageData(pixels, 0, 0);
        // PNG adds no lossy compression. No resizing, crop, enhancement or
        // grading operation occurs here; the source color space is retained.
        self.postMessage({ progress: 'Encoding lossless PNG' });
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        if (blob.type !== 'image/png' || blob.size < 1 || blob.size > MAX_BYTES) {
            throw new Error('The full-resolution PNG exceeds the 50 MB upload limit. Export a smaller photograph before uploading.');
        }
        self.postMessage({ ok: true, blob, width: decoded.width, height: decoded.height, colorSpace: decoded.colorSpace });
    } catch (error) {
        self.postMessage({ ok: false, error: decodeErrors[error?.code] ?? (error instanceof Error ? error.message : decodeErrors.HEIC_DECODE_FAILED) });
    } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
};
