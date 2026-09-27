// Application-neutral acquisition. Callers own identity, persistence and upload.
const PHOTO_MAX_BYTES = 64 * 1024 * 1024;

export const RAPID_CAMERA_CONSTRAINTS = Object.freeze({ audio: false, video: {
    facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 }, resizeMode: { ideal: 'none' }
} });
export function rapidCameraError(error) {
    if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return 'Allow camera access in Safari or Chrome, then tap Resume camera. You can also choose photos below.';
    if (['NotFoundError', 'OverconstrainedError'].includes(error?.name)) return 'No usable camera was found. Connect a camera or choose your photos below.';
    if (['NotReadableError', 'AbortError'].includes(error?.name)) return 'The camera stopped. Close other apps using it, then tap Resume camera.';
    return error?.message || 'The camera could not start. Tap Resume camera or choose photos below.';
}
/** Fit the whole delivered image into the available preview, without cropping. */
export function fitRapidCameraPreview(width, height, availableWidth, availableHeight) {
    if (![width, height, availableWidth, availableHeight].every(value => Number.isFinite(value) && value > 0)) return null;
    const scale = Math.min(availableWidth / width, availableHeight / height);
    return { width: width * scale, height: height * scale };
}
/** Prefer native still bytes when the browser supports them. Safari's video
 * fallback saves every delivered frame pixel as a lossless PNG. Neither path
 * uses the inventory thumbnail or promises the sensor's maximum resolution.
 * matchPreview captures the delivered frame: native still cameras may change
 * field of view independently of the video preview, even at the same ratio. */
export async function captureRapidCameraPhoto(video, track, side, { ImageCaptureImpl = globalThis.ImageCapture,
    documentImpl = globalThis.document, bitmap = globalThis.createImageBitmap, now = Date.now, matchPreview = false } = {}) {
    if (!['FRONT', 'BACK'].includes(side)) throw new Error('Choose the Front or Back before capture.');
    if (!video || video.paused || !video.videoWidth || !video.videoHeight || track?.readyState !== 'live') throw new Error('Wait for a live camera picture, then capture again.');
    const started = now(); let blob, width, height, source, colorSpace;
    if (!matchPreview && typeof ImageCaptureImpl === 'function') {
        try {
            const camera = new ImageCaptureImpl(track), capabilities = await camera.getPhotoCapabilities?.();
            const settings = {};
            for (const field of ['imageWidth', 'imageHeight']) if (Number.isFinite(capabilities?.[field]?.max) && capabilities[field].max > 0) settings[field] = capabilities[field].max;
            blob = await camera.takePhoto(settings);
            source = 'NATIVE_STILL';
            if (typeof bitmap === 'function') { const image = await bitmap(blob); width = image.width; height = image.height; image.close(); }
        } catch (error) {
            if (error?.name !== 'NotSupportedError') throw error;
        }
    }
    if (!blob) {
        const canvas = documentImpl.createElement('canvas');
        width = video.videoWidth; height = video.videoHeight;
        if (width * height > 64 * 1024 * 1024) throw new Error('This camera frame exceeds the 64 megapixel image limit. Choose an original still photo instead.');
        canvas.width = width; canvas.height = height;
        try {
            const context = canvas.getContext('2d', { colorSpace: 'display-p3' });
            if (!context) throw new Error('This frame could not be captured. Try again or choose an original still photo.');
            colorSpace = context.getContextAttributes?.().colorSpace ?? 'srgb';
            context.drawImage(video, 0, 0, width, height);
            blob = await new Promise((resolve, reject) => canvas.toBlob(value => value?.size ? resolve(value) : reject(new Error('The photo could not be captured. Try again.')), 'image/png'));
            if (blob.type !== 'image/png') throw new Error('This browser cannot preserve the camera frame. Choose an original still photo instead.');
            source = 'LOSSLESS_VIDEO_FRAME';
        } finally { canvas.width = 1; canvas.height = 1; }
    }
    if (!blob?.size || blob.size > PHOTO_MAX_BYTES) throw new Error('This photo exceeds the 64 MiB image limit. Choose a supported original photo.');
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[blob.type];
    if (!extension) throw new Error('This camera returned an unsupported still format. Choose an original photo instead.');
    const file = new File([blob], `card-${side.toLowerCase()}-${started}.${extension}`, { type: blob.type, lastModified: started });
    return { file, capture: { source, ...(width && height ? { width, height } : {}), ...(colorSpace ? { colorSpace } : {}),
        capturedAt: new Date(started).toISOString(), elapsedMs: now() - started } };
}
