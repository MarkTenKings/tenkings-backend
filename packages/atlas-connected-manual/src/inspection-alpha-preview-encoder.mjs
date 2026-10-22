import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { requireThat } from '@atlas/manual-service/contract';

// Any native library/platform change allocates a new immutable cache recipe.
export const INSPECTION_ALPHA_PREVIEW_ENCODER = Object.freeze({
  versions: Object.freeze({ ...sharp.versions }), platform: process.platform, arch: process.arch,
});

export function encodeInspectionAlphaPreview(bytes, { signal }) {
  signal.throwIfAborted();
  requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 50 * 1024 * 1024,
    503, 'INSPECTION_ALPHA_SOURCE_INVALID');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./inspection-alpha-preview-worker.mjs', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'ignore'], env: { VIPS_CONCURRENCY: '1', UV_THREADPOOL_SIZE: '1' },
    });
    const chunks = []; let length = 0, failure = null;
    const stop = error => { failure ??= error; child.kill('SIGKILL'); };
    const abort = () => stop(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length > 1024 * 1024) stop(Error('INSPECTION_ALPHA_OUTPUT_LIMIT'));
      else chunks.push(chunk);
    });
    child.on('error', error => { failure ??= error; });
    child.stdin.on('error', error => { failure ??= error; });
    // Settle only after close, including on cancellation. The single CPU slot
    // must not be reused while a timed-out native operation is still running.
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      if (failure || code !== 0 || !length) reject(failure ?? Error('INSPECTION_ALPHA_ENCODE_FAILED'));
      else resolve(Buffer.concat(chunks, length));
    });
    if (signal.aborted) abort();
    else child.stdin.end(bytes);
  });
}
