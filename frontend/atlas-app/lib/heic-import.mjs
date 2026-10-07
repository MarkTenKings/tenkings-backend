const MAX_BYTES = 50 * 1024 * 1024;
export const HEIC_IMPORT_VERSION = 'libheif-js-1.23.2-png-v1';

/** A separate worker per photo bounds decoder lifetime and releases its WASM
 * memory on success, rejection, cancellation and timeout. No image leaves the
 * browser during conversion. The caller persists both original and PNG. */
export function convertHeicPhoto(file, {
    signal,
    onProgress = () => {},
    workerFactory = () => new Worker(new URL('./heic-import.worker.mjs', import.meta.url), { type: 'module' }),
    timeoutMs = 90_000
} = {}) {
    return new Promise((resolve, reject) => {
        let worker, timer, settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            worker?.terminate();
            if (error) reject(error); else resolve(value);
        };
        const abort = () => finish(new Error('HEIC conversion was cancelled. Your saved photographs are kept.'));
        if (signal?.aborted) { abort(); return; }
        try {
            worker = workerFactory();
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => finish(new Error('This HEIC photo took too long to convert. Select it again to retry.')), timeoutMs);
            worker.onerror = event => {
                event.preventDefault?.();
                finish(new Error('HEIC conversion could not start in this browser. Refresh ATLAS and try again.'));
            };
            worker.onmessageerror = () => finish(new Error('The converted photograph could not be read. Select it again.'));
            worker.onmessage = ({ data }) => {
                if (data?.progress && ['Reading HEIC', 'Decoding full-resolution image', 'Encoding lossless PNG'].includes(data.progress)) {
                    if (!settled) onProgress(data.progress);
                    return;
                }
                if (data?.ok !== true) {
                    finish(new Error(typeof data?.error === 'string' ? data.error : 'This HEIC photograph could not be converted.'));
                    return;
                }
                if (!(data.blob instanceof Blob) || data.blob.type !== 'image/png' || data.blob.size < 1 || data.blob.size > MAX_BYTES
                    || !Number.isSafeInteger(data.width) || data.width < 2 || data.width > 16384
                    || !Number.isSafeInteger(data.height) || data.height < 2 || data.height > 16384
                    || data.width * data.height > 64 * 1024 * 1024
                    || !['srgb', 'display-p3'].includes(data.colorSpace)) {
                    finish(new Error('The converted photograph did not meet the upload limits. Your original HEIC is unchanged.'));
                    return;
                }
                finish(null, data);
            };
            worker.postMessage({ file });
        } catch {
            finish(new Error('HEIC conversion is unavailable in this browser. Refresh ATLAS and try again.'));
        }
    });
}
