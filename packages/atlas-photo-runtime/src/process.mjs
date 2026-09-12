import { spawn } from 'node:child_process';

export class PhotoRuntimeError extends Error {
  constructor(code) { super(code); this.name = 'PhotoRuntimeError'; this.code = code; }
}

const readAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
export function isAborted(signal) {
  if (signal === undefined) return false;
  // Validate the native brand before any child or temporary resources exist.
  // Instance method/getter overrides are not part of the cancellation protocol.
  try { return readAborted.call(signal); } catch { throw new PhotoRuntimeError('PHOTO_DECODE_INVALID'); }
}

/** Internal child runner. A timeout/cancellation kills the child and waits for
 * close; the caller may then remove its private temporary files safely. This is
 * process isolation, not a native heap sandbox. Deployment owns that ceiling. */
export function runDecoderProcess(worker, request, { timeoutMs, signal } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new PhotoRuntimeError('PHOTO_DECODE_LIMIT');
  if (isAborted(signal)) return Promise.reject(new PhotoRuntimeError('PHOTO_DECODE_CANCELLED'));
  let serialized;
  try { serialized = JSON.stringify(request); } catch { throw new PhotoRuntimeError('PHOTO_DECODER_PROTOCOL'); }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 32_768) throw new PhotoRuntimeError('PHOTO_DECODER_PROTOCOL');
  return new Promise((resolve, reject) => {
    // Deliberately do not inherit NODE_OPTIONS, loader hooks or application
    // credentials into the image decoder. No shells or child commands are used.
    const child = spawn(process.execPath, [worker], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', UV_THREADPOOL_SIZE: '1', VIPS_CONCURRENCY: '1' },
    });
    let failure = null, stdout = '', stdoutBytes = 0, stderrBytes = 0;
    const stop = code => {
      failure ??= new PhotoRuntimeError(code);
      child.kill('SIGKILL');
    };
    const cancel = () => stop('PHOTO_DECODE_CANCELLED');
    const timer = setTimeout(() => stop('PHOTO_DECODE_TIMEOUT'), timeoutMs);
    if (signal !== undefined) EventTarget.prototype.addEventListener.call(signal, 'abort', cancel, { once: true });
    if (isAborted(signal)) cancel();
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 32_768) stop('PHOTO_DECODER_PROTOCOL');
      else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      // Native diagnostics stay private and are never propagated as user errors.
      stderrBytes += chunk.length;
      if (stderrBytes > 8_192) stop('PHOTO_DECODER_PROTOCOL');
    });
    child.on('error', () => { failure ??= new PhotoRuntimeError('PHOTO_DECODER_UNAVAILABLE'); });
    child.stdin.on('error', () => { /* close/exit provides the terminal result */ });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      if (signal !== undefined) EventTarget.prototype.removeEventListener.call(signal, 'abort', cancel);
      if (failure) { reject(failure); return; }
      if (code !== 0 || exitSignal) { reject(new PhotoRuntimeError('PHOTO_DECODER_FAILED')); return; }
      try {
        const result = JSON.parse(stdout);
        if (result?.ok !== true) {
          const known = ['PHOTO_DECODE_INVALID', 'PHOTO_DECODE_LIMIT', 'PHOTO_FORMAT_UNSUPPORTED',
            'PHOTO_HEIC_UNSUPPORTED', 'PHOTO_HDR_UNSUPPORTED', 'PHOTO_BIT_DEPTH_UNSUPPORTED',
            'PHOTO_MULTIFRAME_UNSUPPORTED', 'PHOTO_SOURCE_MISMATCH', 'PHOTO_UPLOAD_CONFLICT', 'PHOTO_DECODER_UNAVAILABLE'];
          throw new PhotoRuntimeError(known.includes(result?.code) ? result.code : 'PHOTO_DECODER_PROTOCOL');
        }
        resolve(result);
      } catch (error) {
        reject(error instanceof PhotoRuntimeError ? error : new PhotoRuntimeError('PHOTO_DECODER_PROTOCOL'));
      }
    });
    child.stdin.end(serialized);
  });
}
